import { Injectable, inject } from '@angular/core';
import { YoutubeApiService } from './youtube-api.service';
import { YouTubePlaylist, YouTubePlaylistItem } from './youtube-api.types';
import { StorageService } from './StorageService';

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

@Injectable({
  providedIn: 'root',
})
/**
 * Handles Fetching, merging, and persisting playlist + sort metadata
 * Updating modification timestamps
 * Creating playlists
 * Applying sort orders
 */
export class PlaylistService {
  private youtube = inject(YoutubeApiService);
  private storage = inject(StorageService);
  public nextPageToken: string | null | undefined = undefined;
  // Legacy sort state removed (handled by SortService).

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
    let merged: PlaylistColumn[] = [];
    const fetchedMap = new Map(fetched.map((f: PlaylistColumn) => [f.id, f]));

    if (stored && stored.length) {
      merged = stored.map((s) => {
        const f = fetchedMap.get(s.id);
        if (f) {
          // Playlist exists in both stored and fetched - merge
          return {
            ...s,
            // Sorting state removed; managed externally by SortService.
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

    // No internal sorting; ordering will be handled externally by SortService.
    return { playlists: merged, nextPageToken };
  }

  // Legacy updateSortDataWithYouTubeInfo removed.

  public loadState(): PlaylistColumn[] | null {
    const playlists = this.storage.getPlaylists();

    // Legacy migration removed; return stored playlists as-is.

    return playlists;
  }

  /**
   * Initialize manual sort order from current playlist order
   * This should be called after applying a sort method to sync the manual sort with the result
   */
  // Removed legacy sort-related methods (initializeManualSortFromPlaylists, applySort,
  // updateSortIdsAfterSorting, updatePlaylistModified, updateMultiplePlaylistsModified).

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
    this.storage.savePlaylists(merged);

    // Legacy sort metadata removed; SortService will manage custom order persistence.

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
          this.storage.savePlaylists(replaced);

          // No legacy sort metadata to update after purge.
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
