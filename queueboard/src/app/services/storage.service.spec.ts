import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { StorageService } from './StorageService';
import { IndexedDbStorageService } from './IndexedDbStorageService';
import { LocalStorageService } from './LocalStorageService';
import { PlaylistColumn } from './playlist.service';
import { IndexedDbService } from './indexed-db.service';

describe('StorageService (delegation)', () => {
  let svc: StorageService;

  const mockIdbStorage: any = {
    isAvailable: jest.fn(),
    getPlaylists: jest.fn(),
    savePlaylists: jest.fn(),
  };

  const mockLocalStorageSvc: any = {
    getPlaylists: jest.fn(),
    savePlaylists: jest.fn(),
  };

  const mockIndexedDbLowLevel: any = {
    getAll: jest.fn().mockResolvedValue([]),
    clearStore: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: IndexedDbStorageService, useValue: mockIdbStorage },
        { provide: LocalStorageService, useValue: mockLocalStorageSvc },
        { provide: IndexedDbService, useValue: mockIndexedDbLowLevel },
        StorageService,
      ],
    });

    svc = TestBed.inject(StorageService);

    // reset mocks
    jest.clearAllMocks();
  });

  it('delegates to IndexedDbStorageService when available (get/save)', async () => {
    const playlists: PlaylistColumn[] = [
      { id: 'p1', title: 't', videos: [], publishedAt: 1, lastUpdated: 1 },
    ];

    mockIdbStorage.isAvailable.mockResolvedValue(true);
    mockIdbStorage.getPlaylists.mockResolvedValue(playlists);

    const res = await svc.getPlaylists();
    expect(mockIdbStorage.isAvailable).toHaveBeenCalled();
    expect(mockIdbStorage.getPlaylists).toHaveBeenCalled();
    expect(mockLocalStorageSvc.getPlaylists).not.toHaveBeenCalled();
    expect(res).toEqual(playlists);

    // save should call idb save when available
    mockIdbStorage.savePlaylists.mockResolvedValue(undefined);
    await svc.savePlaylists(playlists);
    expect(mockIdbStorage.savePlaylists).toHaveBeenCalledWith(playlists);
    expect(mockLocalStorageSvc.savePlaylists).not.toHaveBeenCalled();
  });

  it('falls back to LocalStorageService when IndexedDB not available', async () => {
    const playlists: PlaylistColumn[] = [
      { id: 'p2', title: 't2', videos: [], publishedAt: 1, lastUpdated: 1 },
    ];

    mockIdbStorage.isAvailable.mockResolvedValue(false);
    mockLocalStorageSvc.getPlaylists.mockResolvedValue(playlists);

    const res = await svc.getPlaylists();
    expect(mockIdbStorage.isAvailable).toHaveBeenCalled();
    expect(mockLocalStorageSvc.getPlaylists).toHaveBeenCalled();
    expect(mockIdbStorage.getPlaylists).not.toHaveBeenCalled();
    expect(res).toEqual(playlists);

    mockLocalStorageSvc.savePlaylists.mockResolvedValue(undefined);
    await svc.savePlaylists(playlists);
    expect(mockLocalStorageSvc.savePlaylists).toHaveBeenCalledWith(playlists);
    expect(mockIdbStorage.savePlaylists).not.toHaveBeenCalled();
  });

  it('clear removes localStorage keys and clears IndexedDB when available', async () => {
    // Spy on global localStorage.removeItem calls
    const origLocal = (global as any).localStorage;
    const mockLocal: any = { removeItem: jest.fn() };
    Object.defineProperty(global, 'localStorage', { value: mockLocal });

    // Make idb probe succeed and ensure low-level clearStore gets called
    mockIdbStorage.isAvailable.mockResolvedValue(true);
    mockIndexedDbLowLevel.getAll.mockResolvedValue([]);

    // Force the cached probe to true so StorageService will call the low-level indexedDb.clearStore
    (svc as any)._indexedDbAvailable = true;

    const result = await svc.clear();
    expect(result).toBe(true);
    expect(mockLocal.removeItem).toHaveBeenCalled();
    expect(mockIndexedDbLowLevel.clearStore).toHaveBeenCalledTimes(2);

    // Restore
    Object.defineProperty(global, 'localStorage', { value: origLocal });
  });
});
