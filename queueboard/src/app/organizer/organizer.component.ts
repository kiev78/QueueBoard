import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  PLATFORM_ID,
  DestroyRef,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  CdkDragDrop,
  moveItemInArray,
  transferArrayItem,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { YouTubePlayerModule } from '@angular/youtube-player';
import { YoutubeApiService } from '../services';
import { environment } from '../../env/environment';
import { VideoPlayerComponent } from './video-player/video-player.component';
import { MinimizedVideosComponent } from './minimized-videos/minimized-videos.component';
import {
  NormalizedPlaylistVideo,
  YouTubePlaylist,
  YouTubePlaylistItem,
} from '../services/youtube-api.types';
import { PollingService } from '../services/PollingService';
import { StorageKey, StorageService } from '../services/StorageService';
import { ErrorHandlerService } from '../services/ErrorHandlerService';
import { PlayerManagerService } from '../services/PlayerManagerService';
import { InputSanitizerService } from '../services/InputSanitizerService';
import {
  PlaylistService,
  VideoCard,
  PlaylistColumn,
  PlaylistSortOrder,
  PlaylistSortOption,
} from '../services/playlist.service';

@Component({
  selector: 'app-organizer',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    DragDropModule,
    FormsModule,
    VideoPlayerComponent,
    MinimizedVideosComponent,
  ],
  templateUrl: './organizer.component.html',
  styleUrls: ['./organizer.component.scss'],
  providers: [PollingService], // Add component-level provider
})
export class OrganizerComponent implements OnInit, OnDestroy {
  // Inject services
  private storage = inject(StorageService);
  private errorHandler = inject(ErrorHandlerService);
  private playerManager = inject(PlayerManagerService);
  private polling = inject(PollingService);
  private sanitizer = inject(InputSanitizerService);
  private destroyRef = inject(DestroyRef);
  private playlistService = inject(PlaylistService);
  private _search = signal('');

  get search(): string {
    return this._search();
  }
  set search(value: string) {
    this._search.set(this.sanitizer.sanitizeSearchQuery(value));
  }

  playlists = signal<PlaylistColumn[]>([]);
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

    // Pagination UI removed - "Load More" sentinel disabled
    // TODO: Re-enable by uncommenting the following block when pagination is restored:
    /*
    if (this.playlistService.nextPageToken) {
      return [...filtered, { id: 'load-more-sentinel', title: 'Next', videos: [] }];
    }
    */
    return filtered;
  });
  hasPlaylists = computed(
    () => this.playlists().length > 0 && this.playlists()[0]?.id !== 'loading'
  );
  connecting = signal(false);
  error = signal<string | null>(null);
  loadingMore = signal(false);

  // Sort-related properties
  currentSortOrder = signal<PlaylistSortOrder>(PlaylistSortOrder.LAST_UPDATED);
  sortOptions: PlaylistSortOption[] = [];

  selectedVideo = signal<VideoCard | null>(null);
  minimizedVideos = signal<VideoCard[]>([]);
  isMinimized = computed(() => this.selectedVideo()?.isMinimized ?? false);
  playerReady = signal(false);
  playerState = signal<YT.PlayerState | null>(null);
  private playerInstances = new Map<string, YT.Player>();

  private pollingInterval: any;
  private platformId = inject(PLATFORM_ID);

  constructor(public youtube: YoutubeApiService) {}

  onSearchFocus() {
    if (this.preloadedAllVideos || this.preloading()) return;
    this.preloading.set(true);
    this.playlistService
      .fetchAllPlaylistItems(this.playlists())
      .then((updatedPlaylists) => {
        this.playlists.set(updatedPlaylists);
        this.preloadedAllVideos = true;
      })
      .catch((e) => console.error('Failed to preload playlist items', e))
      .finally(() => this.preloading.set(false));
  }

  ngOnInit(): void {
    // Load YouTube IFrame API
    if (isPlatformBrowser(this.platformId)) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }

    // Initialize sort options and load saved sort order
    this.sortOptions = this.playlistService.sortOptions;
    const savedSortOrder = this.playlistService.loadSortOrder();
    this.currentSortOrder.set(savedSortOrder);
    this.playlistService.currentSortOrder = savedSortOrder;

    const saved = this.playlistService.loadState();
    const savedManualSort = this.playlistService.loadSortState();

    if (saved) {
      // Load manual sort order if available
      if (savedManualSort && savedManualSort.length > 0) {
        this.playlistService.playlistsSort = savedManualSort;
      }

      // Apply the selected sort method to the saved playlists
      const sortedPlaylists = this.playlistService.applySort(saved);

      // If no manual sort order exists, initialize it from the current sorted order
      if (!savedManualSort || savedManualSort.length === 0) {
        this.playlistService.initializeManualSortFromPlaylists(sortedPlaylists);
      }

      this.playlists.set(sortedPlaylists);
    } else {
      // No saved state - show loading
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
              playlistItemId: 'spinner-item',
            },
          ],
        },
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

      // Fetch all playlists at once - pagination disabled
      // TODO: Re-enable pagination by passing pageToken and reducing maxResults
      const { playlists } = await this.playlistService.fetchAndMergePlaylists(undefined, 50);

      // Apply current sort order and initialize manual sort if needed
      const sortedPlaylists = this.playlistService.applySort(playlists);
      if (this.playlistService.playlistsSort.length === 0) {
        this.playlistService.initializeManualSortFromPlaylists(sortedPlaylists);
      }

      this.playlists.set(sortedPlaylists);
      // nextPageToken tracking disabled for now
      this.playlistService.nextPageToken = undefined; // nextPageToken

      for (const pl of this.playlists()) {
        try {
          if (pl.videos && pl.videos.length > 0) {
            continue;
          }

          // Fetch all videos at once - pagination disabled
          // TODO: Re-enable pagination by reducing limit and using nextPageToken
          const { items } = await this.youtube.fetchPlaylistItems(pl.id, 50);

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

          const curr = [...this.playlists()];
          const idx = curr.findIndex((x) => x.id === pl.id);
          if (idx >= 0) {
            // Update playlist with videos and mark as modified
            curr[idx] = {
              ...curr[idx],
              videos: mapped,
            };
            this.playlists.set(curr);
            // Update the lastModifiedInApp timestamp in sort data
            this.playlistService.updatePlaylistModified(pl.id);
          }
        } catch (e) {
          console.error('Failed to load playlist items for', pl.id, e);
        }
      }

      this.saveState();

      if (this.pollingInterval) clearInterval(this.pollingInterval);
      this.pollingInterval = setInterval(
        () => this.refresh(),
        environment.pollingIntervalMinutes * 60 * 1000
      );
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
      // Use the same merge logic as connectYouTube to maintain date tracking
      const { playlists } = await this.playlistService.fetchAndMergePlaylists(undefined, 50);

      // Apply current sort order and initialize manual sort if needed
      const sortedPlaylists = this.playlistService.applySort(playlists);
      if (this.playlistService.playlistsSort.length === 0) {
        this.playlistService.initializeManualSortFromPlaylists(sortedPlaylists);
      }

      this.playlists.set(sortedPlaylists);
      // nextPageToken tracking disabled for now
      this.playlistService.nextPageToken = undefined;
      this.preloadedAllVideos = false;

      for (const pl of this.playlists()) {
        try {
          if (pl.videos && pl.videos.length > 0) {
            continue;
          }

          // Fetch all videos at once - pagination disabled
          const { items } = await this.youtube.fetchPlaylistItems(pl.id, 50);
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

          const curr = [...this.playlists()];
          const idx = curr.findIndex((x) => x.id === pl.id);
          if (idx >= 0) {
            // Update playlist with videos and mark as modified
            curr[idx] = {
              ...curr[idx],
              videos: mapped,
            };
            this.playlists.set(curr);
            // Update the lastModifiedInApp timestamp in sort data
            this.playlistService.updatePlaylistModified(pl.id);
          }
        } catch (e) {
          console.error('Failed to load playlist items for', pl.id, e);
        }
      }

      this.saveState();
      this.connecting.set(false);
    } catch (err: any) {
      this.error.set(err?.message || String(err));
    } finally {
      this.connecting.set(false);
    }
  }

  async fetchMorePlaylists() {
    // Pagination disabled - this method is kept for future use
    // TODO: Re-enable by checking nextPageToken and using it for pagination
    console.log(
      'FetchMorePlaylists disabled - pagination removed. All playlists are loaded initially.'
    );
    return;

    /* Commented out pagination logic - restore when needed:
    if (this.loadingMore() || !this.playlistService.nextPageToken) {
      return;
    }

    this.loadingMore.set(true);
    try {
      const { playlists: newPlaylists, nextPageToken } = await this.playlistService.fetchAndMergePlaylists(this.playlistService.nextPageToken, 10);
      this.playlists.update(current => [...current, ...newPlaylists]);
      this.playlistService.nextPageToken = nextPageToken;

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
            tags: v.snippet?.tags || [],
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
      this.playlistService.nextPageToken = null;
    } finally {
      this.loadingMore.set(false);
    }
    */
  }

  async loadMoreVideos(playlist: PlaylistColumn) {
    // Pagination disabled - this method is kept for future use
    // TODO: Re-enable by checking playlist.nextPageToken and using it for pagination
    console.log('LoadMoreVideos disabled - pagination removed. All videos are loaded initially.');
    return;

    /* Commented out pagination logic - restore when needed:
    if (!playlist.nextPageToken) return;

    try {
      const updatedPlaylist = await this.playlistService.loadMoreVideos(playlist);
      this.playlists.update(currentPlaylists => {
        const plIndex = currentPlaylists.findIndex(p => p.id === playlist.id);
        if (plIndex > -1) {
          currentPlaylists[plIndex] = updatedPlaylist;
        }
        return [...currentPlaylists];
      });

      this.saveState();
    } catch (e) {
      console.error('Failed to load more videos for playlist', playlist.id, e);
    }
    */
  }

  openVideo(v: VideoCard) {
    // If there's a currently playing (but minimized) video, close it.
    if (this.selectedVideo()) {
      this.closeVideo(this.selectedVideo()!);
    }

    // If the clicked video was in the minimized list, remove it.
    this.minimizedVideos.update((videos) => videos.filter((vid) => vid.id !== v.id));

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
    this.minimizedVideos.update((videos) => videos.filter((v) => v.id !== videoToClose.id));

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

    this.minimizedVideos.update((videos) => {
      if (videos.some((v) => v.id === minimizedVideo.id)) {
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
      this.selectedVideo.update((v) => ({ ...v!, isMinimized: false }));
      this.minimizedVideos.update((videos) => videos.filter((v) => v.id !== video.id));
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

    const video =
      this.selectedVideo()?.id === videoId
        ? this.selectedVideo()
        : this.minimizedVideos().find((v) => v.id === videoId);

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

    const currentTime = new Date().toISOString();
    const curr = [...this.playlists()];

    if (event.previousContainer === event.container) {
      // Moving within same playlist - update lastModifiedInApp
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      // Update the lastModifiedInApp timestamp in sort data
      this.playlistService.updatePlaylistModified(event.container.id);
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

      // Update lastModifiedInApp for both source and destination playlists
      this.playlistService.updateMultiplePlaylistsModified([sourcePlaylistId, destPlaylistId]);

      this.syncMove(videoToMove, sourcePlaylistId, destPlaylistId).catch((err) => {
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
    this.playlistService.playlistsSort = arr
      .filter((p) => p.id !== 'load-more-sentinel')
      .map((p) => ({ id: p.id, sortId: p.sortId! }));
    this.playlists.set(arr);

    // Save the manual sort order changes
    this.saveState();
  }

  trackById(index: number, item: any) {
    return item.id;
  }

  toggleDetails(video: VideoCard) {
    video.detailsVisible = !video.detailsVisible;
  }

  onSortOrderChange(sortOrder: PlaylistSortOrder) {
    this.currentSortOrder.set(sortOrder);
    this.playlistService.saveSortOrder(sortOrder);

    // Re-apply sorting to current playlists
    const currentPlaylists = this.playlists();
    const sortedPlaylists = this.playlistService.applySort(currentPlaylists);

    // Initialize/update manual sort order to match the new sorted order
    this.playlistService.initializeManualSortFromPlaylists(sortedPlaylists);

    this.playlists.set(sortedPlaylists);

    // Save the updated state
    this.saveState();
  }
  private saveState(): void {
    this.storage.setItem(StorageKey.STATE, this.playlists());
    this.storage.setItem(StorageKey.SORT, this.playlistService.playlistsSort);
    // nextPageToken storage disabled since pagination is removed
    // TODO: Re-enable when pagination is restored:
    // this.storage.setItem(StorageKey.NEXT_PAGE_TOKEN, this.playlistService.nextPageToken);
  }
}
