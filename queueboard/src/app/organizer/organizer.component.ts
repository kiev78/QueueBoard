import { Component, OnInit, OnDestroy, signal, computed, inject, PLATFORM_ID, DestroyRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { YouTubePlayerModule } from '@angular/youtube-player';
import { YoutubeApiService } from '../services';
import { environment } from '../../env/environment';
import { VideoPlayerComponent } from './video-player/video-player.component';
import { MinimizedVideosComponent } from './minimized-videos/minimized-videos.component';
import { NormalizedPlaylistVideo, YouTubePlaylist, YouTubePlaylistItem } from '../services/youtube-api.types';
import { PollingService } from '../services/PollingService';
import { StorageService } from '../services/StorageService';
import { ErrorHandlerService } from '../services/ErrorHandlerService';
import { PlayerManagerService } from '../services/PlayerManagerService';
import { InputSanitizerService } from '../services/InputSanitizerService';

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

interface PlaylistColumn {
  id: string;
  title: string;
  description?: string;
  color?: string;
  videos: VideoCard[];
  nextPageToken?: string;
  sortId?: number;
}

interface PlaylistSort {
  id: string;
  sortId: number;
}

@Component({
  selector: 'app-organizer',
  standalone: true,
  imports: [CommonModule, RouterModule, DragDropModule, FormsModule, VideoPlayerComponent, MinimizedVideosComponent],
  templateUrl: './organizer.component.html',
  styleUrls: ['./organizer.component.scss'],
  providers: [PollingService] // Add component-level provider
})
export class OrganizerComponent implements OnInit, OnDestroy {
   // Inject services
  private storage = inject(StorageService);
  private errorHandler = inject(ErrorHandlerService);
  private playerManager = inject(PlayerManagerService);
  private polling = inject(PollingService);
  private sanitizer = inject(InputSanitizerService);
  private destroyRef = inject(DestroyRef);
  private _search = signal('');
  
  get search(): string {
    return this._search();
  }
  set search(value: string) {
    this._search.set(this.sanitizer.sanitizeSearchQuery(value));
  }

  playlists = signal<PlaylistColumn[]>([]);
  playlistsSort: PlaylistSort[] = [];
  private preloadedAllVideos = false;
  preloading = signal(false);
  filteredPlaylists = computed(() => {
    const q = (this.search || '').trim().toLowerCase();
    let filtered = this.playlists();

    if (q) {
      const matchText = (text?: string) => (text || '').toLowerCase().includes(q);
      filtered = this.playlists()
      .map((pl) => {
        const videos = (pl.videos || []).filter((v) => {
          if (matchText(v.title)) return true;
          if (matchText(v.description)) return true;
          if (v.tags && v.tags.some((t: string) => matchText(t))) return true;
          if (matchText(v.channelTitle)) return true;
          return false;
        });

        const playlistMatches = matchText(pl.title) || matchText(pl.description);
        if (playlistMatches) {
          return { ...pl, videos: pl.videos } as PlaylistColumn;
        }

        if (videos.length > 0) {
          return { ...pl, videos } as PlaylistColumn;
        }

        return null;
      })
      .filter((x): x is PlaylistColumn => x !== null);
    }

    if (this.nextPageToken) {
      return [...filtered, { id: 'load-more-sentinel', title: 'Next', videos: [] }];
    }
    return filtered;
  });
  hasPlaylists = computed(() => this.playlists().length > 0 && this.playlists()[0]?.id !== 'loading');
  connecting = signal(false);
  error = signal<string | null>(null);
  loadingMore = signal(false);

  selectedVideo = signal<VideoCard | null>(null);
  minimizedVideos = signal<VideoCard[]>([]);
  isMinimized = computed(() => this.selectedVideo()?.isMinimized ?? false);
  playerReady = signal(false);
  playerState = signal<YT.PlayerState | null>(null);
  private playerInstances = new Map<string, YT.Player>();
  
  private nextPageToken: string | null | undefined = undefined;
  private pollingInterval: any;
  private platformId = inject(PLATFORM_ID);

  constructor(public youtube: YoutubeApiService) {}

  onSearchFocus() {
    if (this.preloadedAllVideos || this.preloading()) return;
    this.preloading.set(true);
    this.fetchAllPlaylistItems(25)
      .catch((e) => console.error('Failed to preload playlist items', e))
      .finally(() => this.preloading.set(false));
  }

  private async fetchAllPlaylistItems(limit = 25) {
    const pls = [...this.playlists()];
    for (const pl of pls) {
      try {
        if (pl.videos && pl.videos.length > 0) continue;
        const { items, nextPageToken } = await this.youtube.fetchPlaylistItems(pl.id, limit);

        const mapped: VideoCard[] = (items as YouTubePlaylistItem[]).map((v: YouTubePlaylistItem) => ({
          id: v.contentDetails?.videoId!,
          playlistItemId: v.id,
          title: v.snippet?.title || '',
          description: v.snippet?.description || '',
          duration: this.youtube.isoDurationToString(v.contentDetails?.duration || ''),
          thumbnail: v.snippet?.thumbnails?.default?.url || '',
          tags: [],
          channelTitle: v.snippet?.channelTitle || '',
          publishedAt: v.snippet?.publishedAt || '',
          youtubeUrl: v.contentDetails?.videoId ? `https://www.youtube.com/watch?v=${v.contentDetails.videoId}` : ''
        }));

        const curr = [...this.playlists()];
        const idx = curr.findIndex(x => x.id === pl.id);
        if (idx >= 0) {
          curr[idx] = { ...curr[idx], videos: mapped, nextPageToken };
          this.playlists.set(curr);
        }
      } catch (e) {
        console.error('Failed to preload playlist items for', pl.id, e);
      }
    }
    this.preloadedAllVideos = true;
  }

  ngOnInit(): void {
    // Load YouTube IFrame API
    if (isPlatformBrowser(this.platformId)) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }

    const saved = this.loadState();
    if (saved) {
      // Apply saved sort order from the full state
      this.playlistsSort = saved.filter(p => p.sortId !== undefined).map(p => ({ id: p.id, sortId: p.sortId! }));
      this.playlists.set(this.applySort(saved));
    } else {
      // Fallback to loading just the sort state if full state is missing
      const savedSort = this.loadSortState();
      if (savedSort) this.playlistsSort = savedSort;
      this.playlists.set([
        {
          id: 'loading',
          title: '',
          description: '',
          color: '#fff',
          videos: [
            {
              id: 'spinner',
              title: '',
              youtubeUrl: '',
              thumbnail: '',
              description: 'Loading...',
              playlistItemId: 'spinner-item'
            }
          ]
        }
      ]);
    }
  }

  ngOnDestroy(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  async connectYouTube() {
    this.error.set(null);
    this.connecting.set(true);
    try {
      await this.youtube.load();
      const token = await this.youtube.requestAccessToken();
      if (!token) {
        this.error.set('User did not grant access');
        return;
      }

      const { playlists, nextPageToken } = await this.fetchAndMergePlaylists(undefined, 10);
      this.playlists.set(playlists);
      this.nextPageToken = nextPageToken;

      for (const pl of this.playlists()) {
        try {
          if (pl.videos && pl.videos.length > 0) {
            continue;
          }

          const { items, nextPageToken } = await this.youtube.fetchPlaylistItems(pl.id, 10);

          const mapped: VideoCard[] = (items as YouTubePlaylistItem[]).map((v: YouTubePlaylistItem) => ({
            id: v.contentDetails?.videoId!,
            playlistItemId: v.id,
            title: v.snippet?.title || '',
            description: v.snippet?.description || '',
            duration: this.youtube.isoDurationToString(v.contentDetails?.duration || ''),
            thumbnail: v.snippet?.thumbnails?.default?.url || '',
            tags: [],
            channelTitle: v.snippet?.channelTitle || '',
            publishedAt: v.snippet?.publishedAt || '',
            youtubeUrl: v.contentDetails?.videoId ? `https://www.youtube.com/watch?v=${v.contentDetails.videoId}` : ''
          }));

          const curr = [...this.playlists()];
          const idx = curr.findIndex(x => x.id === pl.id);
          if (idx >= 0) {
            curr[idx] = { ...curr[idx], videos: mapped, nextPageToken };
            this.playlists.set(curr);
          }
        } catch (e) {
          console.error('Failed to load playlist items for', pl.id, e);
        }
      }

      this.saveState();

      if (this.pollingInterval) clearInterval(this.pollingInterval);
      this.pollingInterval = setInterval(() => this.refresh(), environment.pollingIntervalMinutes * 60 * 1000);

    } catch (err: any) {
      this.error.set(err?.message || String(err)); 
    } finally {
      this.connecting.set(false);
    }
  }

  async refresh() {
    this.error.set(null);
    this.connecting.set(true);
    try {
      const { items: newPlaylistItems, nextPageToken } = await this.youtube.fetchPlaylists(undefined, 10);
      const newPlaylists: PlaylistColumn[] = (newPlaylistItems || []).map((p: YouTubePlaylist) => ({
        id: p.id,
        title: p.snippet?.title || '',
        description: p.snippet?.description || '',
        color: '#e0e0e0',
        videos: [] as VideoCard[]
      }));

      this.playlists.set(this.applySort(newPlaylists));
      this.nextPageToken = nextPageToken;
      this.preloadedAllVideos = false;

      for (const pl of newPlaylists) {
        try {
          const { items, nextPageToken: videoNextPageToken } = await this.youtube.fetchPlaylistItems(pl.id, 10);
          const mapped: VideoCard[] = (items as YouTubePlaylistItem[]).map((v: YouTubePlaylistItem) => ({
            id: v.contentDetails?.videoId!,
            playlistItemId: v.id,
            title: v.snippet?.title || '',
            description: v.snippet?.description || '',
            duration: this.youtube.isoDurationToString(v.contentDetails?.duration || ''),
            thumbnail: v.snippet?.thumbnails?.default?.url || '',
            tags: [],
            channelTitle: v.snippet?.channelTitle || '',
            publishedAt: v.snippet?.publishedAt || '',
            youtubeUrl: v.contentDetails?.videoId ? `https://www.youtube.com/watch?v=${v.contentDetails.videoId}` : ''
          }));

          this.playlists.update(current => 
            current.map(p => p.id === pl.id ? { ...p, videos: mapped, nextPageToken: videoNextPageToken } : p)
          );
        } catch (e) {
          console.error('Failed to load playlist items for', pl.id, e);
        }
      }

      this.saveState();

    } catch (err: any) {
      this.error.set(err?.message || String(err));
    } finally {
      this.connecting.set(false);
    }
  }

  async fetchMorePlaylists() {
    if (this.loadingMore() || !this.nextPageToken) {
      return;
    }

    this.loadingMore.set(true);
    try {
      const { playlists: newPlaylists, nextPageToken } = await this.fetchAndMergePlaylists(this.nextPageToken, 10);
      this.playlists.update(current => [...current, ...newPlaylists]);
      this.nextPageToken = nextPageToken;

      for (const pl of newPlaylists) {
        try {
          const { items, nextPageToken } = await this.youtube.fetchPlaylistItems(pl.id, 10);

          const mapped: VideoCard[] = (items as YouTubePlaylistItem[]).map((v: YouTubePlaylistItem) => ({
            id: v.contentDetails?.videoId!,
            playlistItemId: v.id,
            title: v.snippet?.title || '',
            description: v.snippet?.description || '',
            duration: this.youtube.isoDurationToString(v.contentDetails?.duration || ''),
            thumbnail: v.snippet?.thumbnails?.default?.url || '',
            tags: [],
            channelTitle: v.snippet?.channelTitle || '',
            publishedAt: v.snippet?.publishedAt || '',
            youtubeUrl: v.contentDetails?.videoId ? `https://www.youtube.com/watch?v=${v.contentDetails.videoId}` : ''
          }));

          this.playlists.update(current => current.map(p => p.id === pl.id ? { ...p, videos: mapped, nextPageToken } : p));

        } catch (e) {
          console.error('Failed to load playlist items for', pl.id, e);
        }
      }

      this.saveState();
    } catch (err: any) {
      this.error.set(err?.message || String(err));
      this.nextPageToken = null;
    } finally {
      this.loadingMore.set(false);
    }
  }

  async loadMoreVideos(playlist: PlaylistColumn) {
    if (!playlist.nextPageToken) return;

    try {
      const { items: newVideos, nextPageToken } = await this.youtube.fetchPlaylistItems(playlist.id, 10, playlist.nextPageToken);
      const mapped: VideoCard[] = (newVideos as YouTubePlaylistItem[]).map((v: YouTubePlaylistItem) => ({
        id: v.contentDetails?.videoId!,
        playlistItemId: v.id,
        title: v.snippet?.title || '',
        description: v.snippet?.description || '',
        duration: this.youtube.isoDurationToString(v.contentDetails?.duration || ''),
        thumbnail: v.snippet?.thumbnails?.default?.url || '',
        tags: [],
        channelTitle: v.snippet?.channelTitle || '',
        publishedAt: v.snippet?.publishedAt || '',
        youtubeUrl: v.contentDetails?.videoId ? `https://www.youtube.com/watch?v=${v.contentDetails.videoId}` : ''
      }));

      this.playlists.update(currentPlaylists => {
        const plIndex = currentPlaylists.findIndex(p => p.id === playlist.id);
        if (plIndex > -1) {
          const updatedPlaylist = { ...currentPlaylists[plIndex] };
          updatedPlaylist.videos = [...updatedPlaylist.videos, ...mapped];
          updatedPlaylist.nextPageToken = nextPageToken;
          currentPlaylists[plIndex] = updatedPlaylist;
        }
        return [...currentPlaylists];
      });
      
      this.saveState();
    } catch (e) {
      console.error('Failed to load more videos for playlist', playlist.id, e);
    }
  }

  openVideo(v: VideoCard) {
    // If there's a currently playing (but minimized) video, close it.
    if (this.selectedVideo()) {
      this.closeVideo(this.selectedVideo()!);
    }

    // If the clicked video was in the minimized list, remove it.
    this.minimizedVideos.update(videos => videos.filter(vid => vid.id !== v.id));

    this.selectedVideo.set(v);
    this.playerReady.set(false);
  }

  closeVideo(video?: VideoCard) {
    const videoToClose = video || this.selectedVideo();
    if (!videoToClose) return;

    // If the video to close is the currently selected one
    if (this.selectedVideo()?.id === videoToClose.id) {
      const player = this.playerInstances.get(videoToClose.id);
      player?.destroy();
      this.playerInstances.delete(videoToClose.id);
      this.selectedVideo.set(null);
    }

    // Remove from minimized list
    this.minimizedVideos.update(videos => videos.filter(v => v.id !== videoToClose.id));

    this.playerReady.set(false);
    this.playerState.set(null);
  }

  minimizeVideo() {
    const videoToMinimize = this.selectedVideo();
    if (!videoToMinimize) return;

    const player = this.playerInstances.get(videoToMinimize.id);
    const currentTime = player?.getCurrentTime() ?? 0;

    const minimizedVideo: VideoCard = {
      ...videoToMinimize,
      isMinimized: true,
      resumeTime: currentTime,
    };

    this.minimizedVideos.update(videos => {
      if (videos.some(v => v.id === minimizedVideo.id)) {
        return videos;
      }
      return [...videos, minimizedVideo];
    });

    // Close the main player
    this.selectedVideo.set(null);
    player?.destroy();
    this.playerInstances.delete(videoToMinimize.id);
  }

  restoreVideo(video: VideoCard) {
    if (this.selectedVideo()?.id === video.id) {
      // It's already the selected one, just un-minimize
      this.selectedVideo.update(v => ({ ...v!, isMinimized: false }));
      this.minimizedVideos.update(videos => videos.filter(v => v.id !== video.id));
    } else {
      // A different video is being restored, so open it
      this.openVideo(video);
    }
  }

  onPlayerReady(event: YT.PlayerEvent) {
    const player = event.target;
    const videoUrl = player.getVideoUrl(); // e.g., "https://www.youtube.com/watch?v=VIDEO_ID&feature=..."
    const videoId = new URL(videoUrl).searchParams.get('v');

    if (!videoId) {
      console.error('[onPlayerReady] Could not extract videoId from URL:', videoUrl);
      return;
    }

    this.playerInstances.set(videoId, player);
    
    const video = this.selectedVideo()?.id === videoId 
      ? this.selectedVideo()
      : this.minimizedVideos().find(v => v.id === videoId);

    const startSeconds = Math.floor(video?.resumeTime ?? 0);

    if (startSeconds > 0) {
      player.seekTo(startSeconds, true);
    }
    player.playVideo();
    this.playerReady.set(true); // Keep for main player controls
  }

  onPlayerStateChange(event: YT.PlayerEvent) {
    this.playerState.set(event.data);
  }

  togglePlayPause(video: VideoCard) {
    const player = this.playerInstances.get(video.id);
    if (!player) return;

    const currentState = player.getPlayerState();
    if (currentState === YT.PlayerState.PLAYING || currentState === YT.PlayerState.BUFFERING) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
    // Update the global state so the UI for the minimized icon can react.
    this.playerState.set(player.getPlayerState());
  }

  drop(event: CdkDragDrop<VideoCard[]>) {
    if (!event.previousContainer || !event.container) return;

    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      const videoToMove = event.previousContainer.data[event.previousIndex];
      const sourcePlaylistId = event.previousContainer.id;
      const destPlaylistId = event.container.id;

      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );

      this.syncMove(videoToMove, sourcePlaylistId, destPlaylistId).catch(err => {
        console.error('Failed to sync video move with YouTube:', err);
        this.error.set(`Failed to move video: ${err.message || String(err)}`);
      });
    }
    this.saveState();
  }

  private async syncMove(video: VideoCard, sourcePlaylistId: string, destPlaylistId: string) {
    if (!video.playlistItemId) throw new Error('Cannot move video: missing playlistItemId.');
    if (!video.id) throw new Error('Cannot move video: missing videoId.');

    await this.youtube.removeVideoFromPlaylist(video.playlistItemId);
    await this.youtube.addVideoToPlaylist(destPlaylistId, video.id);
  }

  dropPlaylist(event: CdkDragDrop<PlaylistColumn[]>) {
    const arr = [...this.playlists()];
    moveItemInArray(arr, event.previousIndex, event.currentIndex); 
    arr.forEach((playlist, index) => {
      playlist.sortId = index;
    });
    this.playlistsSort = arr.filter(p => p.id !== 'load-more-sentinel').map(p => ({ id: p.id, sortId: p.sortId! }));
    this.playlists.set(arr); 
    this.saveState();
  }

  trackById(index: number, item: any) {
    return item.id;
  }

  toggleDetails(video: VideoCard) {
    video.detailsVisible = !video.detailsVisible;
  }

  private saveState(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('queueboard_state_v1', JSON.stringify(this.playlists())); 
      localStorage.setItem('queueboard_sort_v1', JSON.stringify(this.playlistsSort));
    } catch (e) {
      console.warn('Failed to persist state', e);
    }
  }

  private async fetchAndMergePlaylists(pageToken?: string, maxResults: number = 10): Promise<{ playlists: PlaylistColumn[], nextPageToken?: string }> {
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

  private loadState(): PlaylistColumn[] | null {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem('queueboard_state_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as PlaylistColumn[];
    } catch (e) {
      console.warn('Failed to load state', e);
    }
    return null;
  }

  private loadSortState(): PlaylistSort[] | null {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem('queueboard_sort_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as PlaylistSort[];
    } catch (e) {
      console.warn('Failed to load sort state', e);
    }
    return null;
  }

  private applySort(playlists: PlaylistColumn[]): PlaylistColumn[] {
    if (this.playlistsSort.length === 0) return playlists;
    const sortMap = new Map(this.playlistsSort.map(s => [s.id, s.sortId]));
    playlists.forEach(p => {
      p.sortId = sortMap.get(p.id);
    });
    return playlists.sort((a, b) => (a.sortId ?? Infinity) - (b.sortId ?? Infinity));
  }
}