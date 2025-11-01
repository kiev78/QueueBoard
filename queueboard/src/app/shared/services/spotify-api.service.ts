import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../env/environment';

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string;
  tracks: {
    total: number;
    items?: SpotifyTrack[];
  };
  images?: SpotifyImage[];
  owner: {
    display_name?: string;
    id: string;
  };
}

export interface SpotifyTrack {
  track: {
    id: string;
    name: string;
    artists: SpotifyArtist[];
    album: {
      name: string;
      images?: SpotifyImage[];
    };
    duration_ms: number;
    external_urls: {
      spotify: string;
    };
  };
}

export interface SpotifyArtist {
  id: string;
  name: string;
}

export interface SpotifyImage {
  url: string;
  width?: number;
  height?: number;
}

export interface SpotifyUserProfile {
  id: string;
  display_name?: string;
  email?: string;
  images?: SpotifyImage[];
}

@Injectable({
  providedIn: 'root',
})
export class SpotifyApiService {
  private platformId = inject(PLATFORM_ID);
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number | null = null;

  private readonly SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
  private readonly SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
  private readonly SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
  private readonly SCOPES = 'playlist-read-private playlist-read-collaborative';
  private readonly TOKEN_KEY = 'queueboard_spotify_token';
  private readonly REFRESH_KEY = 'queueboard_spotify_refresh';
  private readonly EXPIRY_KEY = 'queueboard_spotify_expiry';

  constructor() {
    if (!environment.spotifyClientId) {
      throw new Error('Spotify Client ID not configured in environment');
    }

    if (isPlatformBrowser(this.platformId)) {
      this.loadStoredTokens();
    }
  }

  /**
   * Initiate Spotify OAuth flow
   */
  async authenticate(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('Authentication only available in browser');
    }

    const state = this.generateRandomString(16);
    const codeVerifier = this.generateRandomString(128);
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    // Store code verifier for later use
    sessionStorage.setItem('spotify_code_verifier', codeVerifier);
    sessionStorage.setItem('spotify_state', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: environment.spotifyClientId,
      scope: this.SCOPES,
      redirect_uri: environment.spotifyRedirectUri,
      state: state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    });

    const authUrl = `${this.SPOTIFY_AUTH_URL}?${params.toString()}`;
    console.log('Spotify OAuth URL:', authUrl);
    console.log('Redirect URI being used:', environment.spotifyRedirectUri);
    window.location.href = authUrl;
  }

  /**
   * Handle OAuth callback and exchange code for tokens
   */
  async handleCallback(code: string, state: string): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    const storedState = sessionStorage.getItem('spotify_state');
    const codeVerifier = sessionStorage.getItem('spotify_code_verifier');

    if (!storedState || storedState !== state || !codeVerifier) {
      throw new Error('Invalid state parameter or missing code verifier');
    }

    try {
      const tokenData = await this.exchangeCodeForTokens(code, codeVerifier);
      this.storeTokens(tokenData);

      // Clean up session storage
      sessionStorage.removeItem('spotify_state');
      sessionStorage.removeItem('spotify_code_verifier');

      return true;
    } catch (error) {
      console.error('Failed to exchange authorization code:', error);
      return false;
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.accessToken && (this.tokenExpiry ? Date.now() < this.tokenExpiry : false);
  }

  /**
   * Get current user profile
   */
  async getCurrentUser(): Promise<SpotifyUserProfile> {
    const response = await this.makeAuthenticatedRequest('/me');
    return response;
  }

  /**
   * Get user's playlists with comprehensive data
   */
  async getUserPlaylists(): Promise<SpotifyPlaylist[]> {
    console.log('Fetching Spotify user playlists...');
    const playlists: SpotifyPlaylist[] = [];
    let url = '/me/playlists?limit=50';
    let pageCount = 0;

    while (url) {
      pageCount++;
      console.log(`Fetching playlist page ${pageCount}...`);
      const response = await this.makeAuthenticatedRequest(url);

      if (response.items && response.items.length > 0) {
        playlists.push(...response.items);
        console.log(`Added ${response.items.length} playlists from page ${pageCount}`);
      }

      url = response.next ? response.next.replace(this.SPOTIFY_API_BASE, '') : null;
    }

    console.log(`Total playlists fetched: ${playlists.length}`);
    return playlists;
  }

  /**
   * Get tracks from a specific playlist with comprehensive data and pagination handling
   */
  async getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
    console.log(`Fetching tracks for playlist ${playlistId}...`);
    const tracks: SpotifyTrack[] = [];
    let url = `/playlists/${playlistId}/tracks?limit=50&fields=items(track(id,name,artists(id,name),album(name,images),duration_ms,external_urls)),next,total`;
    let pageCount = 0;

    while (url) {
      pageCount++;
      console.log(`Fetching tracks page ${pageCount} for playlist ${playlistId}...`);
      const response = await this.makeAuthenticatedRequest(url);

      if (response.items && response.items.length > 0) {
        // Filter out null/undefined tracks (can happen with removed/unavailable tracks)
        const validTracks = response.items.filter(
          (item: any) =>
            item.track &&
            item.track.id &&
            item.track.name &&
            item.track.artists &&
            item.track.artists.length > 0,
        );

        tracks.push(...validTracks);
        console.log(
          `Added ${validTracks.length} valid tracks from page ${pageCount} (${response.items.length} total items)`,
        );
      }

      url = response.next ? response.next.replace(this.SPOTIFY_API_BASE, '') : null;
    }

    console.log(`Total tracks fetched for playlist ${playlistId}: ${tracks.length}`);
    return tracks;
  }

  /**
   * Get all playlists with their complete track data
   * This is a comprehensive method that fetches everything at once
   */
  async getAllPlaylistsWithTracks(): Promise<SpotifyPlaylist[]> {
    console.log('Starting comprehensive Spotify data fetch...');

    // First get all playlists
    const playlists = await this.getUserPlaylists();
    console.log(`Found ${playlists.length} playlists. Now fetching tracks for each...`);

    // Then fetch tracks for each playlist
    const playlistsWithTracks: SpotifyPlaylist[] = [];

    for (let i = 0; i < playlists.length; i++) {
      const playlist = playlists[i];
      console.log(
        `Processing playlist ${i + 1}/${playlists.length}: "${playlist.name}" (${playlist.tracks.total} tracks)`,
      );

      try {
        const tracks = await this.getPlaylistTracks(playlist.id);

        // Create a complete playlist object with tracks
        const completePlaylist: SpotifyPlaylist = {
          ...playlist,
          tracks: {
            total: tracks.length,
            items: tracks,
          },
        };

        playlistsWithTracks.push(completePlaylist);
        console.log(`✓ Completed playlist "${playlist.name}" with ${tracks.length} tracks`);
      } catch (error) {
        console.error(`✗ Failed to fetch tracks for playlist "${playlist.name}":`, error);
        // Add playlist without tracks rather than failing completely
        playlistsWithTracks.push(playlist);
      }
    }

    console.log(
      `Comprehensive fetch complete: ${playlistsWithTracks.length} playlists with tracks`,
    );
    return playlistsWithTracks;
  }

  /**
   * Sign out and clear tokens
   */
  signOut(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;

    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_KEY);
    localStorage.removeItem(this.EXPIRY_KEY);
  }

  // Private helper methods

  private async makeAuthenticatedRequest(endpoint: string): Promise<any> {
    if (!this.accessToken) {
      throw new Error('No access token available');
    }

    // Check if token needs refresh
    if (this.tokenExpiry && Date.now() >= this.tokenExpiry - 60000) {
      // Refresh 1 minute early
      await this.refreshAccessToken();
    }

    const response = await fetch(`${this.SPOTIFY_API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired, try to refresh
        await this.refreshAccessToken();
        // Retry the request with new token
        const retryResponse = await fetch(`${this.SPOTIFY_API_BASE}${endpoint}`, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!retryResponse.ok) {
          throw new Error(`Spotify API error: ${retryResponse.status}`);
        }

        return retryResponse.json();
      }

      throw new Error(`Spotify API error: ${response.status}`);
    }

    return response.json();
  }

  private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<any> {
    const response = await fetch(this.SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: environment.spotifyRedirectUri,
        client_id: environment.spotifyClientId,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    return response.json();
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(this.SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: environment.spotifyClientId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const tokenData = await response.json();
    this.storeTokens(tokenData);
  }

  private storeTokens(tokenData: any): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.accessToken = tokenData.access_token;
    this.tokenExpiry = Date.now() + tokenData.expires_in * 1000;

    if (tokenData.refresh_token) {
      this.refreshToken = tokenData.refresh_token;
    }

    if (this.accessToken) {
      localStorage.setItem(this.TOKEN_KEY, this.accessToken);
    }
    localStorage.setItem(this.EXPIRY_KEY, this.tokenExpiry.toString());

    if (this.refreshToken) {
      localStorage.setItem(this.REFRESH_KEY, this.refreshToken);
    }
  }

  private loadStoredTokens(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.accessToken = localStorage.getItem(this.TOKEN_KEY);
    this.refreshToken = localStorage.getItem(this.REFRESH_KEY);

    const expiryStr = localStorage.getItem(this.EXPIRY_KEY);
    this.tokenExpiry = expiryStr ? parseInt(expiryStr, 10) : null;
  }

  private generateRandomString(length: number): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], '');
  }

  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);

    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }
}
