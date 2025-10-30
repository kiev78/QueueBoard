import { IndexedDbStorageService } from './IndexedDbStorageService';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';

describe('IndexedDbStorageService', () => {
  let svc: IndexedDbStorageService;
  const mockIndexedDb: any = {
    getAll: jest.fn(),
    getVideosByPlaylist: jest.fn(),
    put: jest.fn(),
    clearStore: jest.fn(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: (require('./indexed-db.service') as any).IndexedDbService || 'IndexedDbService',
          useValue: mockIndexedDb,
        },
        IndexedDbStorageService,
      ],
    });
    svc = TestBed.inject(IndexedDbStorageService);
  });

  it('getPlaylists returns assembled playlists with thumbnailUrl', async () => {
    const playlists = [{ id: 'p1', title: 't', videos: [], publishedAt: 1, lastUpdated: 1 }];
    const videos = [{ id: 'v1', thumbnailBlob: new Blob(['x']) }];
    mockIndexedDb.getAll.mockResolvedValue(playlists);
    mockIndexedDb.getVideosByPlaylist.mockResolvedValue(videos);

    const res = await svc.getPlaylists();
    expect(res && (res[0].videos[0] as any).thumbnailUrl).toBeDefined();
  });

  it('savePlaylists puts playlist and video and fetches thumbnail when needed', async () => {
    const pl = [
      {
        id: 'p1',
        title: 't',
        videos: [{ id: 'v1', thumbnail: 'http://img', thumbnailBlob: undefined }],
        publishedAt: 1,
        lastUpdated: 1,
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'])) });
    mockIndexedDb.put.mockResolvedValue(undefined);

    await svc.savePlaylists(pl as any);

    expect(mockIndexedDb.put).toHaveBeenCalled();
    (global as any).fetch = undefined;
  });

  it('clear calls clearStore', async () => {
    mockIndexedDb.clearStore.mockResolvedValue(undefined);
    const ok = await svc.clear();
    expect(ok).toBe(true);
    expect(mockIndexedDb.clearStore).toHaveBeenCalled();
  });
});
