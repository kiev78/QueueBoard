import { Injectable, inject } from '@angular/core';
import { YoutubeApiService } from './youtube-api.service';
import { YouTubePlaylist, YouTubePlaylistItem } from './youtube-api.types';
import { StorageKey, StorageService } from './StorageService';

export interface VideoCard {
  id: string;
  playlistItemId?: string;
  title: string;
  description: string;
  duration?: string;
  thumbnail?: string;
  tags?: string[];
  channelTitle?: string;
  publishedAt?: string;
  youtubeUrl: string;
  detailsVisible?: boolean;
  isMinimized?: boolean;
  resumeTime?: number;
}

export interface PlaylistColumn {
  publishedAt: number;
  id: string;
  title: string;
  description?: string;
  color?: string;
  videos: VideoCard[];
  nextPageToken?: string;
  sortId?: number; // This will be set from PlaylistSort during sorting
}

export interface PlaylistSort {
  id: string;
  sortId: number;
  publishedAt?: string; // YouTube's original playlist creation date
  dateAddedToApp?: string; // When playlist was first added to our app
  lastModifiedInApp?: string; // When playlist was last modified in our app
}
export type SortOrder = 'custom' | 'alphabetical' | 'recent';

export interface SortOption {
  value: SortOrder;
  label: string;
}

// Legacy enum for backward compatibility - should be replaced with SortOrder
export enum PlaylistSortOrder {
  CUSTOM = 'custom',
  ALPHABETICAL = 'alphabetical',
  RECENT = 'recent',
  LAST_UPDATED = 'recent', // alias for recent
  DATE_ADDED = 'recent', // alias for recent
  YOUTUBE_CREATED = 'recent', // alias for recent
}

export interface PlaylistSortOption {
  value: PlaylistSortOrder;
  label: string;
}

@Injectable({
  providedIn: 'root',
})
export class PlaylistService {
  private youtube = inject(YoutubeApiService);
  private storage = inject(StorageService);
  public nextPageToken: string | null | undefined = undefined;
  public playlistsSort: PlaylistSort[] = [];

  // Available sort options
  public readonly sortOptions: PlaylistSortOption[] = [
    { value: PlaylistSortOrder.LAST_UPDATED, label: 'Last Modified in App' },
    { value: PlaylistSortOrder.DATE_ADDED, label: 'Added to App (Newest First)' },
    { value: PlaylistSortOrder.YOUTUBE_CREATED, label: 'Created on YouTube (Newest First)' },
    { value: PlaylistSortOrder.ALPHABETICAL, label: 'Alphabetical' },
  ];

  // Current sort order
  public currentSortOrder: PlaylistSortOrder = PlaylistSortOrder.LAST_UPDATED;

  async fetchAllPlaylistItems(playlists: PlaylistColumn[], limit = 50): Promise<PlaylistColumn[]> {
    const updatedPlaylists: PlaylistColumn[] = [];
    for (const pl of playlists) {
      try {
        if (pl.videos && pl.videos.length > 0) {
          updatedPlaylists.push(pl);
          continue;
        }

        // Fetch all videos at once by setting high limit
        // TODO: Re-enable pagination by reducing limit and using nextPageToken
        const { items } = await this.youtube.fetchPlaylistItems(pl.id, limit);

        const mapped: VideoCard[] = (items as YouTubePlaylistItem[]).map(
          (v: YouTubePlaylistItem) => ({
            id: v.contentDetails?.videoId!,
            playlistItemId: v.id,
            title: v.snippet?.title || '',
            description: v.snippet?.description || '',
            duration: this.youtube.isoDurationToString(v.contentDetails?.duration || ''),
            thumbnail: v.snippet?.thumbnails?.default?.url || '',
            tags: v.snippet?.tags || [],
            channelTitle: v.snippet?.channelTitle || '',
            publishedAt: v.snippet?.publishedAt || '',
            youtubeUrl: v.contentDetails?.videoId
              ? `https://www.youtube.com/watch?v=${v.contentDetails.videoId}`
              : '',
          })
        );

        // Note: nextPageToken scaffolding kept for future pagination
        updatedPlaylists.push({ ...pl, videos: mapped }); // , nextPageToken (disabled)
      } catch (e) {
        console.error('Failed to preload playlist items for', pl.id, e);
        updatedPlaylists.push(pl);
      }
    }
    return updatedPlaylists;
  }

  public async fetchAndMergePlaylists(
    pageToken?: string,
    maxResults: number = 50
  ): Promise<{ playlists: PlaylistColumn[]; nextPageToken?: string }> {
    // Fetch all playlists at once - pageToken and pagination disabled for now
    // TODO: Re-enable pagination by using pageToken parameter and reducing maxResults
    const res = await this.youtube.fetchPlaylists(undefined, maxResults); // pageToken disabled
    const currentTime = new Date().toISOString();
    const fetched: PlaylistColumn[] = (res?.items || []).map((p: YouTubePlaylist) => ({
      id: p.id,
      title: p.snippet?.title || '',
      description: p.snippet?.description || '',
      color: '#e0e0e0',
      videos: [] as VideoCard[],
      publishedAt: p.snippet?.publishedAt ? new Date(p.snippet.publishedAt).getTime() : 0,
    }));
    // nextPageToken scaffolding kept for future use
    const nextPageToken = undefined; // res?.nextPageToken (disabled)

    const stored = this.loadState();
    const storedSort = this.loadSortState() || [];
    let merged: PlaylistColumn[] = [];
    const fetchedMap = new Map(fetched.map((f: PlaylistColumn) => [f.id, f]));

    if (stored && stored.length) {
      merged = stored.map((s) => {
        const f = fetchedMap.get(s.id);
        if (f) {
          // Playlist exists in both stored and fetched - merge
          return {
            ...s,
            title: f.title || s.title,
            description: f.description || s.description,
            color: s.color || f.color, // Prefer stored color
            publishedAt: f.publishedAt, // Always use the fresh timestamp from YouTube
          } as PlaylistColumn;
        }
        return s;
      });

      // Add new playlists (not in stored data)
      for (const f of fetched) {
        if (!merged.find((m) => m.id === f.id)) {
          merged.unshift(f);
        }
      }
    } else {
      merged = fetched;
    }

    // Update sort data with YouTube metadata and handle new playlists
    this.updateSortDataWithYouTubeInfo(merged, res?.items || [], storedSort);

    return { playlists: this.applySort(merged), nextPageToken };
  }

  private updateSortDataWithYouTubeInfo(
    playlists: PlaylistColumn[],
    youtubeItems: any[],
    storedSort: PlaylistSort[]
  ): void {
    const currentTime = new Date().toISOString();
    const updatedSort: PlaylistSort[] = [...storedSort];
    const sortMap = new Map(updatedSort.map((s) => [s.id, s]));

    for (const playlist of playlists) {
      const youtubeData = youtubeItems.find((p: any) => p.id === playlist.id);
      const existingSort = sortMap.get(playlist.id);

      if (existingSort) {
        // Update existing sort entry with YouTube data if changed
        const hasChanges =
          youtubeData &&
          (youtubeData.snippet?.title !== playlist.title ||
            youtubeData.snippet?.description !== playlist.description);

        existingSort.publishedAt = youtubeData?.snippet?.publishedAt || existingSort.publishedAt;
        if (hasChanges) {
          existingSort.lastModifiedInApp = currentTime;
        }
      } else {
        // New playlist - create sort entry
        const newSort: PlaylistSort = {
          id: playlist.id,
          sortId: updatedSort.length,
          publishedAt: youtubeData?.snippet?.publishedAt,
          dateAddedToApp: currentTime,
          lastModifiedInApp: currentTime,
        };
        updatedSort.push(newSort);
        sortMap.set(playlist.id, newSort);
      }
    }

    // Save updated sort data
    this.playlistsSort = updatedSort;
    this.storage.setItem(StorageKey.SORT, updatedSort);
  }

  public loadState(): PlaylistColumn[] | null {
    const playlists = this.storage.getItem<PlaylistColumn[]>(StorageKey.STATE, null);

    // Check if we need to migrate old data to the sort format
    if (playlists && playlists.length > 0) {
      const currentTime = new Date().toISOString();
      const storedSort = this.loadSortState() || [];
      const sortMap = new Map(storedSort.map((s) => [s.id, s]));

      // Check if any playlists don't have sort entries or have old date fields
      const needsMigration = playlists.some(
        (p) =>
          !sortMap.has(p.id) ||
          (p as any).dateAdded ||
          (p as any).lastUpdated ||
          (p as any).publishedAt
      );

      if (needsMigration) {
        const migratedSort: PlaylistSort[] = [...storedSort];

        playlists.forEach((playlist, index) => {
          if (!sortMap.has(playlist.id)) {
            // Create new sort entry for this playlist
            migratedSort.push({
              id: playlist.id,
              sortId: index,
              publishedAt: (playlist as any).publishedAt,
              dateAddedToApp: (playlist as any).dateAdded || currentTime,
              lastModifiedInApp: (playlist as any).lastUpdated || currentTime,
            });
          }
        });

        // Save the migrated sort data
        this.storage.setItem(StorageKey.SORT, migratedSort);
        this.playlistsSort = migratedSort;

        // Clean the playlist data of old date fields
        const cleanedPlaylists = playlists.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          color: p.color,
          videos: p.videos,
          nextPageToken: p.nextPageToken,
          sortId: p.sortId,
          publishedAt: p.publishedAt || 0,
        }));

        this.storage.setItem(StorageKey.STATE, cleanedPlaylists);
        return cleanedPlaylists;
      }
    }

    return playlists;
  }

  public loadSortState(): PlaylistSort[] | null {
    return this.storage.getItem<PlaylistSort[]>(StorageKey.SORT, null);
  }

  public loadSortOrder(): PlaylistSortOrder {
    return (
      this.storage.getItem<PlaylistSortOrder>(
        StorageKey.PLAYLIST_SORT_ORDER,
        PlaylistSortOrder.LAST_UPDATED
      ) || PlaylistSortOrder.LAST_UPDATED
    );
  }

  public saveSortOrder(sortOrder: PlaylistSortOrder): void {
    this.currentSortOrder = sortOrder;
    this.storage.setItem(StorageKey.PLAYLIST_SORT_ORDER, sortOrder);
  }

  /**
   * Initialize manual sort order from current playlist order
   * This should be called after applying a sort method to sync the manual sort with the result
   */
  public initializeManualSortFromPlaylists(playlists: PlaylistColumn[]): void {
    // Create manual sort order based on current playlist order
    this.playlistsSort = playlists.map((playlist, index) => ({
      id: playlist.id,
      sortId: index,
    }));

    // Update sortId on playlists to match
    playlists.forEach((playlist, index) => {
      playlist.sortId = index;
    });

    // Save to storage
    this.storage.setItem(StorageKey.SORT, this.playlistsSort);
  }

  public applySort(playlists: PlaylistColumn[]): PlaylistColumn[] {
    const sortedPlaylists = [...playlists];
    const sortMap = new Map(this.playlistsSort.map((s) => [s.id, s]));

    switch (this.currentSortOrder) {
      case PlaylistSortOrder.ALPHABETICAL:
        const alphabetical = sortedPlaylists.sort((a, b) => a.title.localeCompare(b.title));
        // Update sortId to match new order
        this.updateSortIdsAfterSorting(alphabetical);
        return alphabetical;

      case PlaylistSortOrder.DATE_ADDED:
        // Sort by dateAddedToApp from sort data (newest first), fallback to title
        const byDateAdded = sortedPlaylists.sort((a, b) => {
          const sortA = sortMap.get(a.id);
          const sortB = sortMap.get(b.id);
          const dateA = sortA?.dateAddedToApp ? new Date(sortA.dateAddedToApp).getTime() : 0;
          const dateB = sortB?.dateAddedToApp ? new Date(sortB.dateAddedToApp).getTime() : 0;
          if (dateA === dateB) {
            return a.title.localeCompare(b.title);
          }
          return dateB - dateA; // Newest first
        });
        this.updateSortIdsAfterSorting(byDateAdded);
        return byDateAdded;

      case PlaylistSortOrder.YOUTUBE_CREATED:
        // Sort by YouTube's publishedAt from sort data (newest first), fallback to title
        const byYouTubeCreated = sortedPlaylists.sort((a, b) => {
          const sortA = sortMap.get(a.id);
          const sortB = sortMap.get(b.id);
          const dateA = sortA?.publishedAt ? new Date(sortA.publishedAt).getTime() : 0;
          const dateB = sortB?.publishedAt ? new Date(sortB.publishedAt).getTime() : 0;
          if (dateA === dateB) {
            return a.title.localeCompare(b.title);
          }
          return dateB - dateA; // Newest first
        });
        this.updateSortIdsAfterSorting(byYouTubeCreated);
        return byYouTubeCreated;

      case PlaylistSortOrder.LAST_UPDATED:
      default:
        // Sort by lastModifiedInApp from sort data (most recently modified first), fallback to title
        const byLastModified = sortedPlaylists.sort((a, b) => {
          const sortA = sortMap.get(a.id);
          const sortB = sortMap.get(b.id);
          const dateA = sortA?.lastModifiedInApp ? new Date(sortA.lastModifiedInApp).getTime() : 0;
          const dateB = sortB?.lastModifiedInApp ? new Date(sortB.lastModifiedInApp).getTime() : 0;
          if (dateA === dateB) {
            return a.title.localeCompare(b.title);
          }
          return dateB - dateA; // Most recently modified first
        });
        this.updateSortIdsAfterSorting(byLastModified);
        return byLastModified;
    }
  }

  private updateSortIdsAfterSorting(sortedPlaylists: PlaylistColumn[]): void {
    // Update both the sort data and the playlist sortId to match the new order
    sortedPlaylists.forEach((playlist, index) => {
      playlist.sortId = index;
      const sortEntry = this.playlistsSort.find((s) => s.id === playlist.id);
      if (sortEntry) {
        sortEntry.sortId = index;
      }
    });

    // Save the updated sort order
    this.storage.setItem(StorageKey.SORT, this.playlistsSort);
  }

  public updatePlaylistModified(playlistId: string): void {
    const sortEntry = this.playlistsSort.find((s) => s.id === playlistId);
    if (sortEntry) {
      sortEntry.lastModifiedInApp = new Date().toISOString();
      this.storage.setItem(StorageKey.SORT, this.playlistsSort);
    }
  }

  public updateMultiplePlaylistsModified(playlistIds: string[]): void {
    const currentTime = new Date().toISOString();
    let updated = false;

    playlistIds.forEach((playlistId) => {
      const sortEntry = this.playlistsSort.find((s) => s.id === playlistId);
      if (sortEntry) {
        sortEntry.lastModifiedInApp = currentTime;
        updated = true;
      }
    });

    if (updated) {
      this.storage.setItem(StorageKey.SORT, this.playlistsSort);
    }
  }

  /**
   * Create a new playlist both locally and on YouTube (if authenticated).
   * Returns the new PlaylistColumn representing the created playlist.
   */
  public async createPlaylist(title: string, description = ''): Promise<PlaylistColumn> {
    const id = 'local-' + Date.now().toString(36);
    const newPl: PlaylistColumn = {
      id,
      title,
      description,
      color: '#e0e0e0',
      videos: [],
      publishedAt: Date.now(),
    };

    // Persist locally first
    const current = this.loadState() || [];
    const merged = [newPl, ...current];
    this.storage.setItem(StorageKey.STATE, merged);

    // Update sort metadata
    const now = new Date().toISOString();
    const sortEntry: PlaylistSort = {
      id: newPl.id,
      sortId: this.playlistsSort.length,
      dateAddedToApp: now,
      lastModifiedInApp: now,
    } as PlaylistSort;
    this.playlistsSort.push(sortEntry);
    this.storage.setItem(StorageKey.SORT, this.playlistsSort);

    // Attempt to create on YouTube if authenticated
    try {
      if (
        this.youtube.isAuthenticated &&
        typeof this.youtube.isAuthenticated === 'function' &&
        this.youtube.isAuthenticated()
      ) {
        const res = await this.youtube.createPlaylist(title, description);
        if (res && res.id) {
          // Replace local id with YouTube id and persist
          newPl.id = res.id;
          // merge with stored state
          const replaced = merged.map((p) => (p.id === id ? newPl : p));
          this.storage.setItem(StorageKey.STATE, replaced);

          // Update sort entry id
          const sortIdx = this.playlistsSort.findIndex((s) => s.id === id);
          if (sortIdx >= 0) {
            this.playlistsSort[sortIdx].id = res.id;
            this.storage.setItem(StorageKey.SORT, this.playlistsSort);
          }
        }
      }
    } catch (e) {
      console.error('Failed to create playlist on YouTube:', e);
    }

    return newPl;
  }

  async loadMoreVideos(playlist: PlaylistColumn): Promise<PlaylistColumn> {
    // Pagination disabled - this method is kept for future use
    // TODO: Re-enable by checking playlist.nextPageToken and using it for pagination
    console.log('LoadMoreVideos disabled - pagination removed. All videos are loaded initially.');
    return playlist;

    /* Commented out pagination logic - restore when needed:
    if (!playlist.nextPageToken) return playlist;

    const { items: newVideos, nextPageToken } = await this.youtube.fetchPlaylistItems(playlist.id, 10, playlist.nextPageToken);
    const mapped: VideoCard[] = (newVideos as YouTubePlaylistItem[]).map((v: YouTubePlaylistItem) => ({
      id: v.contentDetails?.videoId!,
      playlistItemId: v.id,
      title: v.snippet?.title || '',
      description: v.snippet?.description || '',
      duration: this.youtube.isoDurationToString(v.contentDetails?.duration || ''),
      thumbnail: v.snippet?.thumbnails?.default?.url || '',
      tags: v.snippet?.tags || [],
      channelTitle: v.snippet?.channelTitle || '',
      publishedAt: v.snippet?.publishedAt || '',
      youtubeUrl: v.contentDetails?.videoId ? `https://www.youtube.com/watch?v=${v.contentDetails.videoId}` : ''
    }));

    const updatedPlaylist = { ...playlist };
    updatedPlaylist.videos = [...updatedPlaylist.videos, ...mapped];
    updatedPlaylist.nextPageToken = nextPageToken;

    return updatedPlaylist;
    */
  }
}
