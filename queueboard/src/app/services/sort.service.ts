import { Injectable } from '@angular/core';
import { PlaylistColumn, SortOption, SortOrder, VideoCard } from './playlist.service';
import { StorageKey } from './StorageService';

@Injectable({
  providedIn: 'root',
})
export class SortService {
  readonly sortOptions: SortOption[] = [
    { value: 'custom', label: 'Custom Order' },
    { value: 'alphabetical', label: 'Alphabetical' },
    { value: 'recent', label: 'Recently Added' },
  ];

  loadSortOrder(): SortOrder {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') { 
      return 'custom'; 
    }
    try {
      const saved = localStorage.getItem(StorageKey.PLAYLIST_SORT_ORDER);
      if (saved && ['custom', 'alphabetical', 'recent'].includes(saved)) {
        return saved as SortOrder;
      }
    } catch (e) {
      console.warn('Failed to load sort order:', e);
    }
    return 'custom';
  }

  saveSortOrder(sortOrder: SortOrder): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') { return; }
    try {
      localStorage.setItem(StorageKey.PLAYLIST_SORT_ORDER, sortOrder);
    } catch (e) {
      console.warn('Failed to save sort order:', e);
    }
  }

  loadCustomSortOrder(): string[] {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') { return []; }
    try {
      const saved = localStorage.getItem(StorageKey.SORT);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn('Failed to load custom sort order:', e);
      return [];
    }
  }

  saveCustomSortOrder(playlistIds: string[]): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') { return; }
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

  sortPlaylists(playlists: PlaylistColumn[], sortOrder: SortOrder): PlaylistColumn[] {
    const sorted = [...playlists];

    switch (sortOrder) {
      case 'alphabetical':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'recent':
        sorted.sort((a, b) => {
          const dateA = new Date(a.publishedAt || 0).getTime();
          const dateB = new Date(b.publishedAt || 0).getTime();
          return dateB - dateA; // desc order
        });
        break;
      case 'custom':
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
}
