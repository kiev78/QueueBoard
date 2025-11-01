import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const DB_NAME = 'QueueBoardDB';
const DB_VERSION = 2; // bumped to add segmented stores for Spotify
const PLAYLIST_STORE = 'playlists';
const VIDEO_STORE = 'videos';
const PLAYLIST_STORE_GOOGLE = 'playlists_google';
const VIDEO_STORE_GOOGLE = 'videos_google';
const PLAYLIST_STORE_SPOTIFY = 'playlists_spotify';
const VIDEO_STORE_SPOTIFY = 'videos_spotify';

@Injectable({
  providedIn: 'root',
})
export class IndexedDbService {
  private db: IDBDatabase | null = null;
  private platformId = inject(PLATFORM_ID);
  private dbReady = new Promise<void>((resolve, reject) => {
    if (!isPlatformBrowser(this.platformId)) {
      // Resolve immediately in non-browser environments
      resolve();
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // Legacy stores (backwards compatibility)
      if (!db.objectStoreNames.contains(PLAYLIST_STORE)) {
        db.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(VIDEO_STORE)) {
        const videoStore = db.createObjectStore(VIDEO_STORE, { keyPath: 'id' });
        videoStore.createIndex('playlistId', 'playlistId', { unique: false });
      }

      // Google segmented stores
      if (!db.objectStoreNames.contains(PLAYLIST_STORE_GOOGLE)) {
        db.createObjectStore(PLAYLIST_STORE_GOOGLE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(VIDEO_STORE_GOOGLE)) {
        const vs = db.createObjectStore(VIDEO_STORE_GOOGLE, { keyPath: 'id' });
        vs.createIndex('playlistId', 'playlistId', { unique: false });
      }

      // Spotify segmented stores
      if (!db.objectStoreNames.contains(PLAYLIST_STORE_SPOTIFY)) {
        db.createObjectStore(PLAYLIST_STORE_SPOTIFY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(VIDEO_STORE_SPOTIFY)) {
        const vs2 = db.createObjectStore(VIDEO_STORE_SPOTIFY, { keyPath: 'id' });
        vs2.createIndex('playlistId', 'playlistId', { unique: false });
      }
    };

    request.onsuccess = (event: Event) => {
      this.db = (event.target as IDBOpenDBRequest).result;
      resolve();
    };

    request.onerror = (event: Event) => {
      console.error('IndexedDB error:', (event.target as IDBOpenDBRequest).error);
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  // Helper to get store names based on service
  getStoreNames(service?: 'google' | 'spotify'): { playlistStore: string; videoStore: string } {
    if (service === 'google') {
      return { playlistStore: PLAYLIST_STORE_GOOGLE, videoStore: VIDEO_STORE_GOOGLE };
    } else if (service === 'spotify') {
      return { playlistStore: PLAYLIST_STORE_SPOTIFY, videoStore: VIDEO_STORE_SPOTIFY };
    } else {
      // Default to legacy stores for backwards compatibility
      return { playlistStore: PLAYLIST_STORE, videoStore: VIDEO_STORE };
    }
  }

  // Modified to accept service-specific video store
  async getVideosByPlaylist(playlistId: string, service?: 'google' | 'spotify'): Promise<any[]> {
    const { videoStore } = this.getStoreNames(service);
    const store = await this.getStore(videoStore, 'readonly');
    return new Promise((resolve, reject) => {
      const index = store.index('playlistId');
      const request = index.getAll(playlistId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async getStore(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    await this.dbReady;
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  async get<T>(storeName: string, key: string): Promise<T | undefined> {
    const store = await this.getStore(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    const store = await this.getStore(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName: string, item: any): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearStore(storeName: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
