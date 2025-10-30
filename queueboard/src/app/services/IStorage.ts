import { PlaylistColumn } from './playlist.service';

/**
 * Lightweight storage interface used by StorageService and LocalStorageService.
 * Methods that operate on playlists are async because IndexedDB is async.
 */
export interface IStorage {
  setItem<T>(key: string, value: T): boolean;
  getItem<T>(key: string, defaultValue?: T | null): T | null;
  removeItem(key: string): boolean;
  isAvailable(): boolean;

  // Async methods for larger operations that may use IndexedDB
  clear(): Promise<boolean>;
  getPlaylists(): Promise<PlaylistColumn[] | null>;
  savePlaylists(playlists: PlaylistColumn[]): Promise<void>;
}
