import { Injectable } from '@angular/core';
import { PlaylistColumn, VideoCard } from './playlist.service';
import { PlaylistSortOrder, PLAYLIST_SORT_ORDER } from '../types/sort.types';
import { LOCAL_STORAGE_KEYS as StorageKey, LocalStorageKey } from './local-storage-keys';
import { moveItemInArray } from '@angular/cdk/drag-drop';

@Injectable({
  providedIn: 'root',
})
export class SortService {
  readonly sortOptions: { value: PlaylistSortOrder; label: string }[] = [
    { value: PLAYLIST_SORT_ORDER.CUSTOM, label: 'Custom Order' },
    { value: PLAYLIST_SORT_ORDER.ALPHABETICAL, label: 'Alphabetical' },
    { value: PLAYLIST_SORT_ORDER.RECENT, label: 'Recently Added' },
  ];

  loadSortOrder(): PlaylistSortOrder {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return PLAYLIST_SORT_ORDER.CUSTOM;
    }
    try {
      const saved = localStorage.getItem(StorageKey.PLAYLIST_SORT_ORDER);
      if (
        saved &&
        [
          PLAYLIST_SORT_ORDER.CUSTOM,
          PLAYLIST_SORT_ORDER.ALPHABETICAL,
          PLAYLIST_SORT_ORDER.RECENT,
        ].includes(saved as any)
      ) {
        return saved as PlaylistSortOrder;
      }
    } catch (e) {
      console.warn('Failed to load sort order:', e);
    }
    return PLAYLIST_SORT_ORDER.CUSTOM;
  }

  saveSortOrder(sortOrder: PlaylistSortOrder): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(StorageKey.PLAYLIST_SORT_ORDER, sortOrder);
    } catch (e) {
      console.warn('Failed to save sort order:', e);
    }
  }

  loadCustomSortOrder(): string[] {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return [];
    }
    try {
      const saved = localStorage.getItem(StorageKey.SORT);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      // Legacy format: array of objects with id / sortId
      if (
        Array.isArray(parsed) &&
        parsed.length &&
        typeof parsed[0] === 'object' &&
        parsed[0] !== null &&
        'id' in parsed[0]
      ) {
        const migratedIds = parsed
          .map((p: any) => p.id)
          .filter((id: any) => typeof id === 'string');
        // Persist migrated simple array for future loads
        localStorage.setItem(StorageKey.SORT, JSON.stringify(migratedIds));
        return migratedIds;
      }
      // Current expected format: string[]
      if (Array.isArray(parsed) && (parsed.length === 0 || typeof parsed[0] === 'string')) {
        return parsed as string[];
      }
      return [];
    } catch (e) {
      console.warn('Failed to load custom sort order:', e);
      return [];
    }
  }

  saveCustomSortOrder(playlistIds: string[]): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(StorageKey.SORT, JSON.stringify(playlistIds));
    } catch (e) {
      console.warn('Failed to save custom sort order:', e);
    }
  }

  applyCustomSort(playlists: PlaylistColumn[]): PlaylistColumn[] {
    const customOrder = this.loadCustomSortOrder();
    if (customOrder.length === 0) return playlists;

    const playlistMap = new Map(playlists.map((p) => [p.id, p]));
    const sorted: PlaylistColumn[] = [];

    // Add playlists in custom order
    for (const id of customOrder) {
      const playlist = playlistMap.get(id);
      if (playlist) {
        sorted.push(playlist);
        playlistMap.delete(id);
      }
    }

    // Add any remaining playlists that weren't in the custom order
    sorted.push(...Array.from(playlistMap.values()));

    return sorted;
  }

  sortPlaylists(playlists: PlaylistColumn[], sortOrder: PlaylistSortOrder): PlaylistColumn[] {
    const sorted = [...playlists];

    switch (sortOrder) {
      case PLAYLIST_SORT_ORDER.ALPHABETICAL:
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case PLAYLIST_SORT_ORDER.RECENT:
        sorted.sort((a, b) => {
          const dateA = new Date(a.publishedAt || 0).getTime();
          const dateB = new Date(b.publishedAt || 0).getTime();
          return dateB - dateA; // desc order
        });
        break;
      case PLAYLIST_SORT_ORDER.CUSTOM:
      default:
        // For custom sort, the playlists should already be in the correct order
        // This is handled by applyCustomSort when loading
        break;
    }

    return sorted;
  }

  /**
   * Updates custom sort order when playlists are manually reordered (drag & drop)
   */
  updateCustomSortAfterDrop(playlists: PlaylistColumn[]): void {
    const playlistIds = playlists
      .filter((p) => p.id !== 'load-more-sentinel' && p.id !== 'loading')
      .map((p) => p.id);
    this.saveCustomSortOrder(playlistIds);
  }

  reorderPlaylistsAfterDrag(
    playlists: PlaylistColumn[],
    previousIndex: number,
    currentIndex: number,
    currentSortOrder: PlaylistSortOrder,
  ): { playlists: PlaylistColumn[]; newSortOrder: PlaylistSortOrder } {
    const arr = [...playlists];
    moveItemInArray(arr, previousIndex, currentIndex);

    if (currentSortOrder !== PLAYLIST_SORT_ORDER.CUSTOM) {
      // When dragging in a derived order, treat result as new custom baseline
      this.updateCustomSortAfterDrop(arr);
      return { playlists: arr, newSortOrder: PLAYLIST_SORT_ORDER.CUSTOM };
    }

    this.updateCustomSortAfterDrop(arr);
    return { playlists: arr, newSortOrder: PLAYLIST_SORT_ORDER.CUSTOM };
  }
}
