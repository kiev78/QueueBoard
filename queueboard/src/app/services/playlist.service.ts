
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

@Injectable({
  providedIn: 'root'
})
export class PlaylistService {
  private youtube = inject(YoutubeApiService);
  private storage = inject(StorageService);
  public nextPageToken: string | null | undefined = undefined;
  public playlistsSort: PlaylistSort[] = [];

  async fetchAllPlaylistItems(playlists: PlaylistColumn[], limit = 25): Promise<PlaylistColumn[]> {
    const updatedPlaylists: PlaylistColumn[] = [];
    for (const pl of playlists) {
      try {
        if (pl.videos && pl.videos.length > 0) {
          updatedPlaylists.push(pl);
          continue;
        };
        
        const { items, nextPageToken } = await this.youtube.fetchPlaylistItems(pl.id, limit);

        const mapped: VideoCard[] = (items as YouTubePlaylistItem[]).map((v: YouTubePlaylistItem) => ({
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

        updatedPlaylists.push({ ...pl, videos: mapped, nextPageToken });

      } catch (e) {
        console.error('Failed to preload playlist items for', pl.id, e);
        updatedPlaylists.push(pl);
      }
    }
    return updatedPlaylists;
  }

  public async fetchAndMergePlaylists(pageToken?: string, maxResults: number = 10): Promise<{ playlists: PlaylistColumn[], nextPageToken?: string }> {
    const res = await this.youtube.fetchPlaylists(pageToken, maxResults);
    const fetched: PlaylistColumn[] = (res?.items || []).map((p: YouTubePlaylist) => ({
      id: p.id,
      title: p.snippet?.title || '',
      description: p.snippet?.description || '',
      color: '#e0e0e0',
      videos: [] as VideoCard[]
    }));
    const nextPageToken = res?.nextPageToken;

    const stored = this.loadState();
    let merged: PlaylistColumn[] = [];
    const fetchedMap = new Map(fetched.map((f: PlaylistColumn) => [f.id, f]));

    if (stored && stored.length) {
      if (pageToken) {
        return { playlists: fetched, nextPageToken };
      }

      merged = stored.map((s) => {
        const f = fetchedMap.get(s.id);
        if (f) {
          return { ...s, title: f.title || s.title, description: f.description || s.description, color: f.color || s.color } as PlaylistColumn;
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

  public applySort(playlists: PlaylistColumn[]): PlaylistColumn[] {
    if (this.playlistsSort.length === 0) return playlists;
    const sortMap = new Map(this.playlistsSort.map(s => [s.id, s.sortId]));
    playlists.forEach(p => {
      p.sortId = sortMap.get(p.id);
    });
    return playlists.sort((a, b) => (a.sortId ?? Infinity) - (b.sortId ?? Infinity));
  }

  async loadMoreVideos(playlist: PlaylistColumn): Promise<PlaylistColumn> {
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
  }
}
