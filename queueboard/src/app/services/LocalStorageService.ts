import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PlaylistColumn } from './playlist.service';
import { LOCAL_STORAGE_KEYS, LocalStorageKey } from './local-storage-keys';
import { IStorage } from './IStorage';

/**
 * Safe storage service that wraps localStorage with proper error handling and SSR safety.
 * Prevents QuotaExceededError, serialization errors, and private browsing issues.
 *
 * Usage:
 * ```ts
 * // Store data
 * this.storage.setItem(StorageKey.STATE, this.playlists());
 * this.storage.setItem(StorageKey.NEXT_PAGE_TOKEN, this.nextPageToken);
 *
 * // Retrieve data
 * const playlists = this.storage.getItem<PlaylistColumn[]>(StorageKey.STATE);
 * const nextPageToken = this.storage.getItem<string>(StorageKey.NEXT_PAGE_TOKEN);
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class LocalStorageService implements IStorage {
  private platformId = inject(PLATFORM_ID);
  private readonly MAX_ITEM_SIZE = 1024 * 1024; // 1MB per item
  private readonly MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 5MB total

  /**
   * Safely sets an item in localStorage with size checking and error handling.
   * Returns true if successful, false otherwise.
   */
  setItem<T>(key: LocalStorageKey, value: T): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);

      // Validate size before attempting to store
      if (!this.validateSize(serialized)) {
        console.warn(
          `[StorageService] Item "${key}" exceeds size limit (${serialized.length} bytes)`,
        );
        // Try to free up space
        this.freeUpSpace(key);
        return false;
      }

      localStorage.setItem(key, serialized);
      return true;
    } catch (error) {
      this.handleStorageError(error, 'setItem', key);
      return false;
    }
  }

  /**
   * Safely retrieves and parses an item from localStorage.
   * Returns the parsed value or defaultValue if not found or error occurs.
   */
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
      // Clean up corrupted data
      this.removeItem(key);
      return defaultValue;
    }
  }

  /**
   * Safely removes an item from localStorage.
   * Returns true if successful, false otherwise.
   */
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

  /**
   * Clears all application storage keys.
   * Returns true if successful, false otherwise.
   */
  async clear(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    try {
      Object.values(LOCAL_STORAGE_KEYS).forEach((k) => {
        localStorage.removeItem(k);
      });
      return true;
    } catch (error) {
      console.error('[StorageService] Failed to clear localStorage:', error);
      return false;
    }
  }

  /**
   * Gets the approximate size of all stored application data in bytes.
   */
  getStorageSize(): number {
    if (!isPlatformBrowser(this.platformId)) {
      return 0;
    }

    let total = 0;
    try {
      Object.values(LOCAL_STORAGE_KEYS).forEach((k) => {
        const item = localStorage.getItem(k);
        if (item) {
          // UTF-16 encoding uses 2 bytes per character
          total += item.length * 2;
        }
      });
    } catch (error) {
      console.error('[StorageService] Failed to calculate storage size:', error);
    }
    return total;
  }

  /**
   * Checks if localStorage is available and accessible.
   * Useful for detecting private browsing mode and other restrictions.
   */
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

  // Async playlist methods to satisfy IStorage (IndexedDB allocator expects async)
  async getPlaylists(): Promise<PlaylistColumn[] | null> {
    return this.getItem<PlaylistColumn[]>(LOCAL_STORAGE_KEYS.STATE);
  }

  // Keep synchronous helper for callers that expect immediate return
  savePlaylistsSync(playlists: PlaylistColumn[]): void {
    this.setItem(LOCAL_STORAGE_KEYS.STATE, playlists);
  }

  async savePlaylists(playlists: PlaylistColumn[]): Promise<void> {
    this.savePlaylistsSync(playlists);
  }

  /**
   * Validates that serialized data doesn't exceed size limits.
   */
  private validateSize(serialized: string): boolean {
    if (serialized.length > this.MAX_ITEM_SIZE) {
      return false;
    }

    const currentSize = this.getStorageSize();
    if (currentSize + serialized.length > this.MAX_TOTAL_SIZE) {
      return false;
    }

    return true;
  }

  /**
   * Handles different types of storage errors with appropriate logging.
   */
  private handleStorageError(error: unknown, operation: string, key: LocalStorageKey): void {
    if (error instanceof DOMException) {
      switch (error.name) {
        case 'QuotaExceededError':
          console.error(
            `[StorageService] Quota exceeded during ${operation} on "${key}". ` +
              `Current size: ${this.getStorageSize()} bytes`,
          );
          break;
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

  /**
   * Attempts to free up space by removing less critical items.
   * Priority: NEXT_PAGE_TOKEN < SORT < STATE
   */
  private freeUpSpace(failedKey: LocalStorageKey): void {
    console.warn('[StorageService] Attempting to free up localStorage space...');

    // Priority order for deletion (least to most important)
    const priorityOrder: LocalStorageKey[] = [
      LOCAL_STORAGE_KEYS.NEXT_PAGE_TOKEN,
      LOCAL_STORAGE_KEYS.SORT,
      LOCAL_STORAGE_KEYS.STATE,
    ];

    for (const key of priorityOrder) {
      if (key === failedKey || key === LOCAL_STORAGE_KEYS.GAPI_TOKEN) {
        continue; // Don't remove the key we're trying to save or auth token
      }

      this.removeItem(key);

      // Check if we have space now
      try {
        const testData = JSON.stringify({ test: true });
        localStorage.setItem('__test__', testData);
        localStorage.removeItem('__test__');
        console.log(`[StorageService] Successfully freed up space by removing "${key}"`);
        return;
      } catch {
        continue; // Still no space, try next key
      }
    }

    console.warn('[StorageService] Unable to free up enough space');
  }
}
