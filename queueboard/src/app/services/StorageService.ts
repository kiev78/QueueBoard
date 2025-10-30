import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PlaylistColumn, VideoCard } from './playlist.service';
import { IndexedDbService } from './indexed-db.service';
import { IndexedDbStorageService } from './IndexedDbStorageService';
import { LocalStorageService } from './LocalStorageService';
import { IStorage } from './IStorage';
import { LOCAL_STORAGE_KEYS, LocalStorageKey } from './local-storage-keys';
import { FORCE_LOCAL_STORAGE } from './storage.tokens';
// PLATFORM_ID and isPlatformBrowser already imported above

const PLAYLIST_STORE = 'playlists';
const VIDEO_STORE = 'videos';

@Injectable({
  providedIn: 'root',
})
export class StorageService implements IStorage {
  private platformId = inject(PLATFORM_ID);
  private indexedDb = inject(IndexedDbService);
  private idbStorage = inject(IndexedDbStorageService);
  private localStorageSvc = inject(LocalStorageService);
  // optional injection token to force using localStorage (fallback) in tests/environments
  private forceLocal = (() => {
    try {
      return inject(FORCE_LOCAL_STORAGE, { optional: true });
    } catch {
      return undefined as unknown as boolean | undefined;
    }
  })();
  // cached result for IndexedDB usability check
  private _indexedDbAvailable: boolean | null = null;

  setItem<T>(key: LocalStorageKey, value: T): boolean {
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

  getItem<T>(key: LocalStorageKey, defaultValue: T | null = null): T | null {
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

  removeItem(key: LocalStorageKey): boolean {
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
    if (!isPlatformBrowser(this.platformId)) return false;

    try {
      // Always clear localStorage keys
      Object.values(LOCAL_STORAGE_KEYS).forEach((k) => {
        localStorage.removeItem(k);
      });

      if (await this.isIndexedDbAvailable()) {
        await this.indexedDb.clearStore(PLAYLIST_STORE);
        await this.indexedDb.clearStore(VIDEO_STORE);
      }
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
    // If forceLocal is set, prefer localStorage. Otherwise prefer IndexedDB when available.
    if (!this.forceLocal && (await this.idbStorage.isAvailable())) {
      const playlists = await this.idbStorage.getPlaylists();
      if (!playlists || playlists.length === 0) {
        return null;
      }
      return playlists;
    }

    // Fallback: use LocalStorageService which stores the full state in localStorage
    return this.localStorageSvc.getPlaylists();
  }

  async savePlaylists(playlists: PlaylistColumn[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (!this.forceLocal && (await this.idbStorage.isAvailable())) {
      await this.idbStorage.savePlaylists(playlists);
      return;
    }

    // Fallback: store full playlists array in localStorage
    await this.localStorageSvc.savePlaylists(playlists);
  }

  /**
   * Lightweight check to determine if IndexedDB is usable in this environment.
   * Caches the result after the first probe.
   */
  private async isIndexedDbAvailable(): Promise<boolean> {
    if (this._indexedDbAvailable !== null) return this._indexedDbAvailable;
    if (!isPlatformBrowser(this.platformId)) {
      this._indexedDbAvailable = false;
      return false;
    }

    // Honor forceLocal: when true, do not use IndexedDB
    if (this.forceLocal) {
      this._indexedDbAvailable = false;
      return false;
    }

    // Basic feature detection
    if (typeof indexedDB === 'undefined') {
      this._indexedDbAvailable = false;
      return false;
    }

    // Probe by attempting a small read; if it throws or rejects, mark unavailable
    try {
      await this.indexedDb.getAll(PLAYLIST_STORE);
      this._indexedDbAvailable = true;
      return true;
    } catch (e) {
      console.warn('[StorageService] IndexedDB unavailable, falling back to localStorage', e);
      this._indexedDbAvailable = false;
      return false;
    }
  }

  private handleStorageError(error: unknown, operation: string, key: LocalStorageKey): void {
    if (error instanceof DOMException) {
      switch (error.name) {
        case 'SecurityError':
          console.error(
            `[StorageService] Security error during ${operation} (possibly private browsing mode)`,
          );
          break;
        default:
          console.error(
            `[StorageService] DOM Exception "${error.name}" during ${operation} on "${key}"`,
          );
      }
    } else if (error instanceof SyntaxError) {
      console.error(`[StorageService] JSON parsing error during ${operation} on "${key}"`);
    } else {
      console.error(`[StorageService] Unexpected error during ${operation} on "${key}":`, error);
    }
  }
}
