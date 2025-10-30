import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PlaylistColumn, VideoCard } from './playlist.service';
import { IndexedDbService } from './indexed-db.service';

export enum StorageKey {
  SORT = 'queueboard_sort_v1',
  PLAYLIST_SORT_ORDER = 'queueboard_sort_order_v1',
  GAPI_TOKEN = 'queueboard_gapi_token',
  NEXT_PAGE_TOKEN = 'queueboard_next_page_token_v1',
  DARK_MODE = 'queueboard_dark_mode_v1',
}

const PLAYLIST_STORE = 'playlists';
const VIDEO_STORE = 'videos';

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private platformId = inject(PLATFORM_ID);
  private indexedDb = inject(IndexedDbService);

  setItem<T>(key: StorageKey, value: T): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(key, serialized);
      return true;
    } catch (error) {
      this.handleStorageError(error, 'setItem', key);
      return false;
    }
  }

  getItem<T>(key: StorageKey, defaultValue: T | null = null): T | null {
    if (!isPlatformBrowser(this.platformId)) {
      return defaultValue;
    }

    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return defaultValue;
      }

      const parsed = JSON.parse(raw) as T;
      return parsed;
    } catch (error) {
      console.warn(`[StorageService] Failed to parse item "${key}":`, error);
      this.removeItem(key);
      return defaultValue;
    }
  }

  removeItem(key: StorageKey): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error(`[StorageService] Failed to remove item "${key}":`, error);
      return false;
    }
  }

  async clear(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    try {
      Object.values(StorageKey).forEach((key) => {
        localStorage.removeItem(key);
      });
      await this.indexedDb.clearStore(PLAYLIST_STORE);
      await this.indexedDb.clearStore(VIDEO_STORE);
      return true;
    } catch (error) {
      console.error('[StorageService] Failed to clear storage:', error);
      return false;
    }
  }

  isAvailable(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  async getPlaylists(): Promise<PlaylistColumn[] | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    const playlists = await this.indexedDb.getAll<PlaylistColumn>(PLAYLIST_STORE);
    if (!playlists || playlists.length === 0) {
      return null;
    }

    for (const playlist of playlists) {
      const videos = await this.indexedDb.getVideosByPlaylist(playlist.id);
      playlist.videos = videos.map((video: any) => {
        if (video.thumbnailBlob) {
          video.thumbnailUrl = URL.createObjectURL(video.thumbnailBlob);
        }
        return video;
      });
    }

    return playlists;
  }

  async savePlaylists(playlists: PlaylistColumn[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    for (const playlist of playlists) {
      const { videos, ...playlistData } = playlist;
      await this.indexedDb.put(PLAYLIST_STORE, playlistData);

      if (videos) {
        for (const video of videos) {
          const videoWithPlaylistId = { ...video, playlistId: playlist.id };
          if (video.thumbnail && !video.thumbnailBlob) {
            try {
              const response = await fetch(video.thumbnail);
              const blob = await response.blob();
              videoWithPlaylistId.thumbnailBlob = blob;
            } catch (error) {
              console.error(`Failed to fetch thumbnail for video ${video.id}:`, error);
            }
          }
          await this.indexedDb.put(VIDEO_STORE, videoWithPlaylistId);
        }
      }
    }
  }

  private handleStorageError(error: unknown, operation: string, key: StorageKey): void {
    if (error instanceof DOMException) {
      switch (error.name) {
        case 'SecurityError':
          console.error(
            `[StorageService] Security error during ${operation} (possibly private browsing mode)`
          );
          break;
        default:
          console.error(
            `[StorageService] DOM Exception "${error.name}" during ${operation} on "${key}"`
          );
      }
    } else if (error instanceof SyntaxError) {
      console.error(`[StorageService] JSON parsing error during ${operation} on "${key}"`);
    } else {
      console.error(`[StorageService] Unexpected error during ${operation} on "${key}":`, error);
    }
  }
}
