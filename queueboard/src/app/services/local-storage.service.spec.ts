import { LocalStorageService } from './LocalStorageService';
import { LOCAL_STORAGE_KEYS } from './local-storage-keys';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';

describe('LocalStorageService', () => {
  let svc: LocalStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }, LocalStorageService],
    });
    svc = TestBed.inject(LocalStorageService);
    // ensure clean localStorage
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('set/get/remove basic flow', () => {
    expect(svc.setItem(LOCAL_STORAGE_KEYS.SORT, ['a', 'b'])).toBe(true);
    const got = svc.getItem<string[]>(LOCAL_STORAGE_KEYS.SORT);
    expect(got).toEqual(['a', 'b']);
    expect(svc.removeItem(LOCAL_STORAGE_KEYS.SORT)).toBe(true);
    expect(svc.getItem<string[]>(LOCAL_STORAGE_KEYS.SORT)).toBeNull();
  });

  it('isAvailable returns true when localStorage operable', () => {
    expect(svc.isAvailable()).toBe(true);
  });

  it('getStorageSize accounts for stored items', () => {
    svc.setItem(LOCAL_STORAGE_KEYS.SORT, ['one']);
    svc.setItem(LOCAL_STORAGE_KEYS.PLAYLIST_SORT_ORDER, 'custom');
    const size = svc.getStorageSize();
    expect(size).toBeGreaterThan(0);
  });

  it('savePlaylists and getPlaylists roundtrip', async () => {
    const pl = [
      {
        id: 'p1',
        title: 'T',
        description: '',
        color: '#fff',
        videos: [],
        publishedAt: Date.now(),
        lastUpdated: Date.now(),
      },
    ];
    await svc.savePlaylists(pl);
    const got = await svc.getPlaylists();
    expect(got).toEqual(pl);
  });

  it('isAvailable handles restricted storage (simulated SecurityError)', () => {
    const globalObj: any = globalThis as any;
    const originalDesc = Object.getOwnPropertyDescriptor(globalObj, 'localStorage');
    // Provide a minimal mock that throws on setItem
    Object.defineProperty(globalObj, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        setItem: () => {
          throw new DOMException('denied', 'SecurityError');
        },
        removeItem: () => {},
        getItem: () => null,
      },
    });

    try {
      expect(svc.isAvailable()).toBe(false);
    } finally {
      if (originalDesc) Object.defineProperty(globalObj, 'localStorage', originalDesc);
      else delete (globalObj as any).localStorage;
    }
  });
});
