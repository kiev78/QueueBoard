import { TestBed } from '@angular/core/testing';
import { SortService } from './sort.service';
import { PlaylistSortOrder, PLAYLIST_SORT_ORDER } from '../types/sort.types';
import { PlaylistColumn } from './playlist.service';
import { LOCAL_STORAGE_KEYS } from './local-storage-keys';

describe('SortService', () => {
  let service: SortService;
  let mockPlaylists: PlaylistColumn[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SortService);

    // Clear local storage before each test
    localStorage.clear();

    mockPlaylists = [
      { id: '1', title: 'A Playlist', publishedAt: 1000, lastUpdated: 1000, videos: [] },
      { id: '2', title: 'B Playlist', publishedAt: 2000, lastUpdated: 3000, videos: [] },
      { id: '3', title: 'C Playlist', publishedAt: 3000, lastUpdated: 2000, videos: [] },
    ];
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('loads default sort order as custom when nothing stored', () => {
    expect(service.loadSortOrder()).toBe(PLAYLIST_SORT_ORDER.CUSTOM);
  });

  it('saves and loads sort order', () => {
    service.saveSortOrder(PLAYLIST_SORT_ORDER.ALPHABETICAL);
    expect(service.loadSortOrder()).toBe(PLAYLIST_SORT_ORDER.ALPHABETICAL);
  });

  it('sorts alphabetically', () => {
    const sorted = service.sortPlaylists(mockPlaylists, PLAYLIST_SORT_ORDER.ALPHABETICAL);
    expect(sorted[0].id).toBe('1');
    expect(sorted[1].id).toBe('2');
    expect(sorted[2].id).toBe('3');
  });

  it('sorts by recently added using lastUpdated (descending)', () => {
    // Expected order based on lastUpdated:
    // id '2' (3000)
    // id '3' (2000)
    // id '1' (1000)
    const sorted = service.sortPlaylists(mockPlaylists, PLAYLIST_SORT_ORDER.RECENT);
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('3');
    expect(sorted[2].id).toBe('1');
  });

  it('falls back to publishedAt if lastUpdated is missing for recent sort', () => {
    const playlistsWithMissingLastUpdated: any[] = [
      { id: '1', title: 'A', publishedAt: 1000 },
      { id: '2', title: 'B', publishedAt: 3000 },
      { id: '3', title: 'C', publishedAt: 2000 },
    ];

    const sorted = service.sortPlaylists(playlistsWithMissingLastUpdated, PLAYLIST_SORT_ORDER.RECENT);
    // Expected order based on publishedAt desc:
    // id '2' (3000)
    // id '3' (2000)
    // id '1' (1000)
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('3');
    expect(sorted[2].id).toBe('1');
  });

  it('applyCustomSort orders playlists according to stored IDs', () => {
    service.saveCustomSortOrder(['3', '1', '2']);
    const sorted = service.applyCustomSort(mockPlaylists);
    expect(sorted[0].id).toBe('3');
    expect(sorted[1].id).toBe('1');
    expect(sorted[2].id).toBe('2');
  });

  it('updates custom sort order after drag', () => {
    // Current custom order from setUp is default (empty), so default sort is typically applied.
    // Let's pretend we are in ALPHABETICAL mode initially.
    service.saveSortOrder(PLAYLIST_SORT_ORDER.ALPHABETICAL);

    // mockPlaylists order: 1, 2, 3 (from setUp)
    // Drag '1' (index 0) to position 1
    const result = service.reorderPlaylistsAfterDrag(mockPlaylists, 0, 1, PLAYLIST_SORT_ORDER.ALPHABETICAL);

    // Expect order to change to 2, 1, 3
    expect(result.playlists[0].id).toBe('2');
    expect(result.playlists[1].id).toBe('1');
    expect(result.playlists[2].id).toBe('3');

    // Should switch to custom mode
    expect(result.newSortOrder).toBe(PLAYLIST_SORT_ORDER.CUSTOM);

    // Verify persisted custom order
    const stored = service.loadCustomSortOrder();
    expect(stored).toEqual(['2', '1', '3']);
  });

  it('migrates legacy custom sort object array to string array', () => {
    // Write legacy data to local storage
    const legacyData = JSON.stringify([{ id: '3' }, { id: '1' }, { id: '2' }]);
    localStorage.setItem(LOCAL_STORAGE_KEYS.SORT, legacyData);

    // Calling loadCustomSortOrder should trigger migration
    const migrated = service.loadCustomSortOrder();

    expect(migrated).toEqual(['3', '1', '2']);

    // Verify storage is updated to new format
    const storedRaw = localStorage.getItem(LOCAL_STORAGE_KEYS.SORT);
    expect(storedRaw).toBe(JSON.stringify(['3', '1', '2']));
  });

});
