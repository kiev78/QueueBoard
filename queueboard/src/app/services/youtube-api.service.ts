import { Injectable } from '@angular/core';
import { environment } from '../../env/environment';

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
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
  scope = 'https://www.googleapis.com/auth/youtube.readonly';

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
  async fetchPlaylistItems(playlistId: string, maxResults = 10, pageToken?: string) {
    if (!this.accessToken) throw new Error('Not authenticated');

    const listRes = await window.gapi.client.youtube.playlistItems.list({
      part: 'snippet,contentDetails',
      playlistId,
      maxResults,
      pageToken
    });

    const items = listRes.result.items || [];
    const videoIds = items
      .map((it: any) => it.snippet?.resourceId?.videoId)
      .filter((v: any) => !!v);

    if (videoIds.length === 0) return { items: [], nextPageToken: listRes.result.nextPageToken };

    const vidsRes = await window.gapi.client.youtube.videos.list({
      part: 'snippet,contentDetails',
      id: videoIds.join(','),
      maxResults: videoIds.length
    });

    const vids = vidsRes.result.items || [];

    // Map video details into a small DTO
    const mappedVids = vids.map((v: any) => ({
      id: v.id,
      title: v.snippet?.title,
      description: v.snippet?.description,
      duration: v.contentDetails?.duration, // ISO 8601 duration
      thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
      tags: v.snippet?.tags || [],
      channelTitle: v.snippet?.channelTitle,
      publishedAt: v.snippet?.publishedAt,
      youtubeUrl: `https://youtube.com/watch?v=${v.id}`
    }));

    return { items: mappedVids, nextPageToken: listRes.result.nextPageToken };
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
