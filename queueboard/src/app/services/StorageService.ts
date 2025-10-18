import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export enum StorageKey {
  STATE = 'queueboard_state_v1',
  SORT = 'queueboard_sort_v1',
  GAPI_TOKEN = 'queueboard_gapi_token'
}

/**
 * Safe storage service that handles browser APIs with proper error handling and SSR safety.
 * Prevents QuotaExceededError and serialization issues.
 */
@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private platformId = inject(PLATFORM_ID);
  private readonly MAX_ITEM_SIZE = 1024 * 1024; // 1MB per item
  private readonly MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 5MB total

  /**
   * Safely sets an item in localStorage with size checking and error handling
   */
  setItem<T>(key: StorageKey, value: T): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);

      // Validate size
      if (!this.validateSize(serialized)) {
        console.warn(`[StorageService] Item "${key}" exceeds size limit (${serialized.length} bytes)`);
        // Try to free up space by removing less critical items
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
   * Safely retrieves and parses an item from localStorage
   */
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
      // Clean up corrupted data
      this.removeItem(key);
      return defaultValue;
    }
  }

  /**
   * Safely removes an item from localStorage
   */
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

  /**
   * Clears all application data from localStorage
   */
  clear(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    try {
      Object.values(StorageKey).forEach(key => {
        localStorage.removeItem(key);
      });
      return true;
    } catch (error) {
      console.error('[StorageService] Failed to clear localStorage:', error);
      return false;
    }
  }

  /**
   * Gets the approximate size of stored data in bytes
   */
  getStorageSize(): number {
    if (!isPlatformBrowser(this.platformId)) {
      return 0;
    }

    let total = 0;
    try {
      Object.values(StorageKey).forEach(key => {
        const item = localStorage.getItem(key);
        if (item) {
          total += item.length * 2; // UTF-16 uses 2 bytes per character
        }
      });
    } catch (error) {
      console.error('[StorageService] Failed to calculate storage size:', error);
    }
    return total;
  }

  /**
   * Validates item size against limits
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
   * Handles storage-specific errors
   */
  private handleStorageError(error: unknown, operation: string, key: StorageKey): void {
    if (error instanceof DOMException) {
      switch (error.name) {
        case 'QuotaExceededError':
          console.error(`[StorageService] Quota exceeded during ${operation} on "${key}"`);
          break;
        case 'SecurityError':
          console.error(`[StorageService] Security error during ${operation} (possibly private browsing)`);
          break;
        default:
          console.error(`[StorageService] DOM Exception during ${operation} on "${key}":`, error.name);
      }
    } else if (error instanceof SyntaxError) {
      console.error(`[StorageService] JSON parsing error during ${operation} on "${key}"`);
    } else {
      console.error(`[StorageService] Unexpected error during ${operation} on "${key}":`, error);
    }
  }

  /**
   * Attempts to free up space by removing less critical items
   */
  private freeUpSpace(failedKey: StorageKey): void {
    console.warn('[StorageService] Attempting to free up localStorage space...');

    // Priority order for deletion (least to most important)
    const keysToRemove = Object.values(StorageKey)
      .filter(k => k !== failedKey && k !== StorageKey.GAPI_TOKEN)
      .sort();

    for (const key of keysToRemove) {
      this.removeItem(key);

      // Check if we have space now
      try {
        const testData = JSON.stringify({ test: true });
        localStorage.setItem('__test__', testData);
        localStorage.removeItem('__test__');
        console.log('[StorageService] Successfully freed up space');
        return;
      } catch {
        continue; // Still no space, try next key
      }
    }

    console.warn('[StorageService] Unable to free up enough space');
  }

  /**
   * Checks if localStorage is available
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
}