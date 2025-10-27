import { SortService } from './sort.service';
import { StorageKey } from './StorageService';
import { PlaylistColumn } from './playlist.service';
import { PLAYLIST_SORT_ORDER } from '../types/sort.types';

describe('SortService', () => {
  let service: SortService;

  beforeEach(() => {
    service = new SortService();
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  function mockPlaylists(count: number): PlaylistColumn[] {
    return Array.from({ length: count }).map((_, i) => ({
      id: `pl-${i + 1}`,
      title: `Playlist ${i + 1}`,
      description: '',
      color: '#ccc',
      videos: [],
      publishedAt: Date.now() - i * 1000,
    }));
  }

  it('loads default sort order as custom when nothing stored', () => {
    expect(service.loadSortOrder()).toBe(PLAYLIST_SORT_ORDER.CUSTOM);
  });

  it('saves and loads sort order', () => {
    service.saveSortOrder(PLAYLIST_SORT_ORDER.ALPHABETICAL);
    expect(service.loadSortOrder()).toBe(PLAYLIST_SORT_ORDER.ALPHABETICAL);
  });

  it('migrates legacy object array custom sort to id array', () => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      pending('localStorage not available in this environment');
      return;
    }
    const legacy = [
      { id: 'pl-2', sortId: 1 },
      { id: 'pl-1', sortId: 0 },
    ];
    localStorage.setItem(StorageKey.SORT, JSON.stringify(legacy));
    const order = service.loadCustomSortOrder();
    expect(order).toEqual(['pl-2', 'pl-1']);
    const persisted = JSON.parse(localStorage.getItem(StorageKey.SORT) || '[]');
    expect(persisted).toEqual(['pl-2', 'pl-1']);
  });

  it('applyCustomSort orders playlists according to stored IDs', () => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      pending('localStorage not available in this environment');
      return;
    }
    const playlists = mockPlaylists(3);
    service.saveCustomSortOrder(['pl-3', 'pl-1']);
    const sorted = service.applyCustomSort(playlists);
    expect(sorted.map((p) => p.id)).toEqual(['pl-3', 'pl-1', 'pl-2']);
  });

  it('reorderPlaylistsAfterDrag switches to custom when not custom', () => {
    const playlists = mockPlaylists(3);
    const result = service.reorderPlaylistsAfterDrag(playlists, 0, 2, PLAYLIST_SORT_ORDER.RECENT);
    expect(result.newSortOrder).toBe(PLAYLIST_SORT_ORDER.CUSTOM);
    expect(result.playlists.map((p) => p.id)).toEqual(['pl-2', 'pl-3', 'pl-1']);
  });

  it('reorderPlaylistsAfterDrag preserves custom mode', () => {
    const playlists = mockPlaylists(3);
    const result = service.reorderPlaylistsAfterDrag(playlists, 1, 0, PLAYLIST_SORT_ORDER.CUSTOM);
    expect(result.newSortOrder).toBe(PLAYLIST_SORT_ORDER.CUSTOM);
    expect(result.playlists.map((p) => p.id)).toEqual(['pl-2', 'pl-1', 'pl-3']);
  });

  it('applyCustomSort leaves order unchanged when no custom ids stored', () => {
    const playlists = mockPlaylists(2);
    const sorted = service.applyCustomSort(playlists);
    expect(sorted.map((p) => p.id)).toEqual(['pl-1', 'pl-2']);
  });

  it('reorderPlaylistsAfterDrag persists new custom order when starting alphabetical', () => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      pending('localStorage not available in this environment');
      return;
    }
    const playlists = mockPlaylists(3);
    service.saveSortOrder(PLAYLIST_SORT_ORDER.ALPHABETICAL);
    const { playlists: reordered } = service.reorderPlaylistsAfterDrag(
      playlists,
      2,
      0,
      PLAYLIST_SORT_ORDER.ALPHABETICAL
    );
    expect(reordered.map((p) => p.id)).toEqual(['pl-3', 'pl-1', 'pl-2']);
    const stored = JSON.parse(localStorage.getItem(StorageKey.SORT) || '[]');
    expect(stored).toEqual(['pl-3', 'pl-1', 'pl-2']);
  });
});
