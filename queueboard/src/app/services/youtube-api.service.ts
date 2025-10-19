import { Injectable } from '@angular/core';
import { environment } from '../../env/environment';
import { YouTubeApiResponse, YouTubePlaylistItem } from './youtube-api.types';

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

// A minimal type for the YouTube Video resource
interface YouTubeVideoResource {
  snippet: { tags?: string[] };
  contentDetails: { duration: string };
}

@Injectable({ providedIn: 'root' })
export class YoutubeApiService {
  private gapiLoaded = false;
  private gisLoaded = false;
  private tokenClient: any = null;
  private accessToken: string | null = null;
  private tokenStorageKey = 'queueboard_gapi_token';

  clientId = environment.googleClientId;
  apiKey = environment.googleApiKey;
  discoveryDocs = ['https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest'];
  scope = 'https://www.googleapis.com/auth/youtube';

  async load(): Promise<void> {
    // Validate developer-supplied credentials to avoid unclear errors from the Google APIs
    if (!this.clientId || this.clientId.includes('YOUR') || this.clientId.includes('<')) {
      throw new Error('Google OAuth Client ID is not set. Please set environment.googleClientId in src/environments/environment.ts (no angle brackets).');
    }
    if (!this.apiKey || this.apiKey.includes('YOUR') || this.apiKey.includes('<')) {
      throw new Error('Google API Key is not set. Please set environment.googleApiKey in src/environments/environment.ts (no angle brackets) and enable the YouTube Data API v3.');
    }

    await Promise.all([this.loadGapi(), this.loadGis()]);
    await this.initClient();

    // restore token from session storage if available and still valid
    try {
      const raw = sessionStorage.getItem(this.tokenStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.accessToken && parsed.expiresAt && parsed.expiresAt > Date.now()) {
          this.accessToken = parsed.accessToken;
          // set the token on gapi client so requests are authorized
          if (window?.gapi?.client) {
            window.gapi.client.setToken({ access_token: this.accessToken });
          }
        } else {
          sessionStorage.removeItem(this.tokenStorageKey);
        }
      }
    } catch (e) {
      console.warn('Failed to restore token from sessionStorage', e);
    }
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  private async loadGapi() {
    if (this.gapiLoaded) return;
    await this.loadScript('https://apis.google.com/js/api.js');
    this.gapiLoaded = true;
  }

  private async loadGis() {
    if (this.gisLoaded) return;
    await this.loadScript('https://accounts.google.com/gsi/client');
    this.gisLoaded = true;
  }

  private async initClient() {
    if (!this.gapiLoaded) throw new Error('gapi not loaded');

    return new Promise<void>((resolve, reject) => {
      window.gapi.load('client', async () => {
        try {
          await window.gapi.client.init({ apiKey: this.apiKey, discoveryDocs: this.discoveryDocs });
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  createTokenClient(callback: (token: string | null) => void) {
    if (!this.gisLoaded) throw new Error('Google Identity Services not loaded');
    if (!this.tokenClient) {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: this.scope,
        callback: (resp: any) => {
          if (resp && resp.access_token) {
            this.accessToken = resp.access_token;
            // store token with expiry (expires_in is seconds)
            const expiresIn = resp.expires_in ? Number(resp.expires_in) : 3600;
            const expiresAt = Date.now() + expiresIn * 1000;
            try {
              sessionStorage.setItem(this.tokenStorageKey, JSON.stringify({ accessToken: this.accessToken, expiresAt }));
            } catch (e) {
              console.warn('Failed to persist token to sessionStorage', e);
            }
            // set on gapi client
            try { window.gapi.client.setToken({ access_token: this.accessToken }); } catch (e) {}
            callback(this.accessToken);
          } else {
            this.accessToken = null;
            sessionStorage.removeItem(this.tokenStorageKey);
            callback(null);
          }
        }
      });
    }
    return this.tokenClient;
  }

  requestAccessToken(): Promise<string | null> {
    // if we already have a valid token in memory/session, return it
    const stored = this.getStoredToken();
    if (stored) {
      this.accessToken = stored.accessToken;
      try { window.gapi.client.setToken({ access_token: this.accessToken }); } catch (e) {}
      return Promise.resolve(this.accessToken);
    }

    return new Promise((resolve) => {
      const client = this.createTokenClient((token) => {
        resolve(token);
      });

      client.requestAccessToken();
    });
  }

  private getStoredToken(): { accessToken: string; expiresAt: number } | null {
    try {
      const raw = sessionStorage.getItem(this.tokenStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.accessToken && parsed.expiresAt && parsed.expiresAt > Date.now()) {
        return parsed;
      }
      sessionStorage.removeItem(this.tokenStorageKey);
    } catch (e) {
      // ignore
    }
    return null;
  }

  signOut() {
    this.accessToken = null;
    try { sessionStorage.removeItem(this.tokenStorageKey); } catch (e) {}
    try { if (window?.gapi?.client) window.gapi.client.setToken(null); } catch (e) {}
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  async fetchPlaylists(pageToken?: string, maxResults = 10) {
    if (!this.accessToken) throw new Error('Not authenticated');
    const params: any = { mine: true, maxResults, pageToken };
    const res = await window.gapi.client.youtube.playlists.list({
      part: 'id,snippet,contentDetails',
      ...params
    });

    return { ...res.result, items: res.result.items || [] };
  }

  /**
   * Fetch playlist items and then fetch video details (snippet + contentDetails)
   */
  async fetchPlaylistItems(playlistId: string, maxResults = 10, pageToken?: string) :Promise<YouTubeApiResponse<YouTubePlaylistItem>> {
        if (!this.accessToken) throw new Error('Not authenticated');

    const listRes = await window.gapi.client.youtube.playlistItems.list({
      part: 'id,snippet,contentDetails',
      playlistId,
      maxResults,
      pageToken
    });

    const items = listRes.result.items || [];
    const videoIds = items
      .map((it: YouTubePlaylistItem) => it.snippet?.resourceId?.videoId)
      .filter((v: any) => !!v);

    if (videoIds.length === 0) return { items: [], nextPageToken: listRes.result.nextPageToken };

    const vidsRes = await window.gapi.client.youtube.videos.list({
      part: 'snippet,contentDetails',
      id: videoIds.join(','),
      maxResults: videoIds.length
    });

    const videoDetailsMap = new Map<string, YouTubeVideoResource>((vidsRes.result.items || []).map((v: any) => [v.id, v]));

    // Merge video details (duration, tags) into the playlist item structure.
    const mappedVids = items.map((item: any) => {
      const videoId = item.snippet.resourceId.videoId;
      const videoDetails = videoDetailsMap.get(videoId);
      if (videoDetails) {
        // Add duration from the video's contentDetails to the playlistItem's contentDetails.
        item.contentDetails.duration = videoDetails.contentDetails?.duration;
        // Add tags from the video's snippet.
        item.snippet.tags = videoDetails.snippet?.tags;
      }
      return item;
    });

    return { items: mappedVids, nextPageToken: listRes.result.nextPageToken };
  }

  async addVideoToPlaylist(playlistId: string, videoId: string) {
    if (!this.accessToken) throw new Error('Not authenticated for write operations.');
    const response = await window.gapi.client.youtube.playlistItems.insert({
      part: 'snippet',
      resource: {
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } }
      }
    });
    return response.result;
  }

  async removeVideoFromPlaylist(playlistItemId: string) {
    if (!this.accessToken) throw new Error('Not authenticated for write operations.');
    return await window.gapi.client.youtube.playlistItems.delete({ id: playlistItemId });
  }

  // Small helper to convert ISO8601 duration to hh:mm:ss or mm:ss
  isoDurationToString(iso: string | undefined) {
    if (!iso) return '';
    // Simple parse using regex
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return iso;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    const s = seconds.toString().padStart(2, '0');
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${s}`;
    }
    return `${minutes}:${s}`;
  }
}
