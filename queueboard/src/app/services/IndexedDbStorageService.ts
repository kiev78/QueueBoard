import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { IStorage } from './IStorage';
import { PlaylistColumn } from './playlist.service';
import { IndexedDbService } from './indexed-db.service';

const PLAYLIST_STORE = 'playlists';
const VIDEO_STORE = 'videos';

@Injectable({ providedIn: 'root' })
export class IndexedDbStorageService implements IStorage {
  private platformId = inject(PLATFORM_ID);
  private indexedDb = inject(IndexedDbService);

  // for small key/value helpers we still use localStorage
  setItem<T>(key: string, value: T): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[IndexedDbStorageService] setItem failed', e);
      return false;
    }
  }

  getItem<T>(key: string, defaultValue: T | null = null): T | null {
    if (!isPlatformBrowser(this.platformId)) return defaultValue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultValue;
      return JSON.parse(raw) as T;
    } catch (e) {
      console.warn('[IndexedDbStorageService] getItem parse failed', e);
      localStorage.removeItem(key);
      return defaultValue;
    }
  }

  removeItem(key: string): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error('[IndexedDbStorageService] removeItem failed', e);
      return false;
    }
  }

  isAvailable(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return typeof indexedDB !== 'undefined';
  }

  async clear(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;
    try {
      await this.indexedDb.clearStore(PLAYLIST_STORE);
      await this.indexedDb.clearStore(VIDEO_STORE);
      return true;
    } catch (e) {
      console.error('[IndexedDbStorageService] Failed to clear stores', e);
      return false;
    }
  }

  async getPlaylists(service?: 'google' | 'spotify'): Promise<PlaylistColumn[] | null> {
    if (!isPlatformBrowser(this.platformId)) return null;

    try {
      const { playlistStore } = this.indexedDb.getStoreNames(service);
      const playlists = await this.indexedDb.getAll<PlaylistColumn>(playlistStore);
      if (!playlists || playlists.length === 0) return null;

      for (const playlist of playlists) {
        const videos = await this.indexedDb.getVideosByPlaylist(playlist.id, service);
        playlist.videos = videos;
      }

      return playlists;
    } catch (e) {
      console.warn('[IndexedDbStorageService] getPlaylists failed', e);
      return null;
    }
  }

  async savePlaylists(playlists: PlaylistColumn[], service?: 'google' | 'spotify'): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const { playlistStore, videoStore } = this.indexedDb.getStoreNames(service);

    for (const playlist of playlists) {
      const { videos, ...playlistData } = playlist;
      try {
        await this.indexedDb.put(playlistStore, playlistData);
      } catch (e) {
        console.error('[IndexedDbStorageService] Failed to put playlist', e);
      }

      if (videos) {
        for (const video of videos) {
          const videoWithPlaylistId = { ...video, playlistId: playlist.id } as any;
          try {
            await this.indexedDb.put(videoStore, videoWithPlaylistId);
          } catch (e) {
            console.error('[IndexedDbStorageService] Failed to put video', e);
          }
        }
      }
    }
  }
}
