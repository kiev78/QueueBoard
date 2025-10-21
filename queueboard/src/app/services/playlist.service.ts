import { Injectable, inject } from '@angular/core';
import { YoutubeApiService } from './youtube-api.service';
import { YouTubePlaylist, YouTubePlaylistItem } from './youtube-api.types';
import { StorageKey, StorageService } from './StorageService';

export interface VideoCard {
  playlistItemId: string;
  id: string;
  title: string;
  description?: string;
  duration?: string;
  thumbnail?: string;
  tags?: string[];
  channelTitle?: string;
  publishedAt?: string;
  youtubeUrl?: string;
  detailsVisible?: boolean;
  isMinimized?: boolean;
  isPlaying?: boolean;
  resumeTime?: number;
}

export interface PlaylistColumn {
  id: string;
  title: string;
  description?: string;
  color?: string;
  videos: VideoCard[];
  nextPageToken?: string;
  sortId?: number;
}

export interface PlaylistSort {
  id: string;
  sortId: number;
}

export enum PlaylistSortOrder {
  LAST_UPDATED = 'last_updated',
  DATE_ADDED = 'date_added',
  ALPHABETICAL = 'alphabetical',
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
    { value: PlaylistSortOrder.LAST_UPDATED, label: 'Last Updated (Default)' },
    { value: PlaylistSortOrder.DATE_ADDED, label: 'Date Added' },
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
    const fetched: PlaylistColumn[] = (res?.items || []).map((p: YouTubePlaylist) => ({
      id: p.id,
      title: p.snippet?.title || '',
      description: p.snippet?.description || '',
      color: '#e0e0e0',
      videos: [] as VideoCard[],
    }));
    // nextPageToken scaffolding kept for future use
    const nextPageToken = undefined; // res?.nextPageToken (disabled)

    const stored = this.loadState();
    let merged: PlaylistColumn[] = [];
    const fetchedMap = new Map(fetched.map((f: PlaylistColumn) => [f.id, f]));

    if (stored && stored.length) {
      // Skip pagination logic when pageToken is provided for now
      // if (pageToken) {
      //   return { playlists: fetched, nextPageToken };
      // }

      merged = stored.map((s) => {
        const f = fetchedMap.get(s.id);
        if (f) {
          return {
            ...s,
            title: f.title || s.title,
            description: f.description || s.description,
            color: f.color || s.color,
          } as PlaylistColumn;
        }
        return s;
      });

      for (const f of fetched) {
        if (!merged.find((m) => m.id === f.id)) {
          merged.unshift(f);
        }
      }
    } else {
      merged = fetched;
    }

    return { playlists: this.applySort(merged), nextPageToken };
  }

  public loadState(): PlaylistColumn[] | null {
    return this.storage.getItem<PlaylistColumn[]>(StorageKey.STATE, null);
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

  public applySort(playlists: PlaylistColumn[]): PlaylistColumn[] {
    const sortedPlaylists = [...playlists];

    switch (this.currentSortOrder) {
      case PlaylistSortOrder.ALPHABETICAL:
        return sortedPlaylists.sort((a, b) => a.title.localeCompare(b.title));

      case PlaylistSortOrder.DATE_ADDED:
        // Use manual sort order if available, otherwise use YouTube's default order
        if (this.playlistsSort.length === 0) return sortedPlaylists;
        const sortMap = new Map(this.playlistsSort.map((s) => [s.id, s.sortId]));
        playlists.forEach((p) => {
          p.sortId = sortMap.get(p.id);
        });
        return sortedPlaylists.sort((a, b) => (a.sortId ?? Infinity) - (b.sortId ?? Infinity));

      case PlaylistSortOrder.LAST_UPDATED:
      default:
        // Default YouTube API order (most recently updated first)
        return sortedPlaylists;
    }
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
