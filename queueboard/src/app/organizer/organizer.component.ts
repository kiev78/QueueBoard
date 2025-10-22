import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  PLATFORM_ID,
  DestroyRef,
  HostListener,
  ViewChild,
  ElementRef,
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
  PlaylistColumn,
  PlaylistService,
  VideoCard,
  SortOrder,
  SortOption,
} from '../services/playlist.service';
import { SortService } from '../services/sort.service';

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
  private sortService = inject(SortService);
  private _search = signal('');
  
// Add this ViewChild decorator to get a reference to the search input
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

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

    // Apply sorting using SortService
    const sorted = this.sortService.sortPlaylists(filtered, this.currentSortOrder());

    // Pagination UI removed - "Load More" sentinel disabled
    // TODO: Re-enable by uncommenting the following block when pagination is restored:
    /*
    if (this.playlistService.nextPageToken) {
      return [...sorted, { id: 'load-more-sentinel', title: 'Next', videos: [] }];
    }
    */
    return sorted;
  });
  hasPlaylists = computed(
    () => this.playlists().length > 0 && this.playlists()[0]?.id !== 'loading'
  );
  connecting = signal(false);
  error = signal<string | null>(null);
  loadingMore = signal(false);

  // Sort-related properties
  currentSortOrder = signal<SortOrder>('custom');
  get sortOptions(): SortOption[] {
    return this.sortService.sortOptions;
  }

  // Add playlist UI state
  showAddPlaylist = signal(false);
  newPlaylistName = signal('');
  // Per-playlist add-video UI state (visibility)
  addVideoVisible = signal<Record<string, boolean>>({});
  // per-playlist adding indicator
  addVideoLoading = signal<Record<string, boolean>>({});

  // Dark mode toggle state
  isDarkMode = signal(false);

  selectedVideo = signal<VideoCard | null>(null);
  minimizedVideos = signal<VideoCard[]>([]);
  isMinimized = computed(() => this.selectedVideo()?.isMinimized ?? false);
  playerReady = signal(false);

  // Helper methods for template
  showAddVideoForm(playlistId: string): void {
    this.addVideoVisible.update((m) => ({ ...(m || {}), [playlistId]: true }));
  }

  hideAddVideoForm(playlistId: string): void {
    this.addVideoVisible.update((m) => ({ ...(m || {}), [playlistId]: false }));
  }
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

  /**
   * Listens for global keydown events on the window.
   * When '/' is pressed, it focuses the search input, unless the user is
   * currently typing in another input, textarea, or contenteditable element.
   * @param event The KeyboardEvent from the window.
   */
  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent): void {
    // Skip when typing in inputs, textareas, or contenteditable elements
    const target = event.target as HTMLElement;
    const tagName = target.tagName;
    if (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    // If the '/' key is pressed and the search input exists, focus it.
    if (event.key === '/' && this.searchInput) {
      event.preventDefault(); // Prevent the '/' character from being typed
      this.searchInput.nativeElement.focus();
    }
  }

  ngOnInit(): void {
    // Load YouTube IFrame API
    if (isPlatformBrowser(this.platformId)) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }

    // Initialize dark mode from localStorage or system preference
    this.initializeDarkMode();

    // Load saved sort order using SortService
    const savedSortOrder = this.sortService.loadSortOrder();
    this.currentSortOrder.set(savedSortOrder);

    const saved = this.loadState();

    if (saved) {
      // Apply custom sort if available, otherwise use the saved playlists as-is
      const sortedPlaylists = this.sortService.applyCustomSort(saved);
      this.playlists.set(sortedPlaylists);
    } else {
      // No saved state - show loading
      this.playlists.set([
        {
          id: 'loading',
          title: '',
          description: '',
          color: '#fff',
          publishedAt: 0,
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
    const currentSort = this.currentSortOrder();

    if (currentSort === 'custom') {
      // In custom mode: update the raw playlists order directly
      const arr = [...this.playlists()];
      moveItemInArray(arr, event.previousIndex, event.currentIndex);
      this.playlists.set(arr);

      // Update custom sort order storage
      this.sortService.updateCustomSortAfterDrop(arr);
    } else {
      // In alphabetical/recent mode: capture current filtered order and switch to custom
      const currentFiltered = [...this.filteredPlaylists()];
      moveItemInArray(currentFiltered, event.previousIndex, event.currentIndex);

      // Set this as the new raw playlists order
      this.playlists.set(currentFiltered);

      // Update custom sort order storage
      this.sortService.updateCustomSortAfterDrop(currentFiltered);

      // Switch to custom mode
      this.currentSortOrder.set('custom');
      this.sortService.saveSortOrder('custom');
    }

    // Save the updated state
    this.saveState();
  }

  trackById(index: number, item: any) {
    return item.id;
  }

  toggleDetails(video: VideoCard) {
    video.detailsVisible = !video.detailsVisible;
  }

  onSortOrderChange(sortOrder: SortOrder) {
    this.currentSortOrder.set(sortOrder);
    this.sortService.saveSortOrder(sortOrder);

    // The computed filteredPlaylists will automatically update with the new sort
    // No need to manually re-sort here since it's handled by the computed signal
  }

  async createPlaylistFromUI() {
    const name = (this.newPlaylistName() || '').trim();
    if (!name) return;

    this.connecting.set(true);
    try {
      const created = await this.playlistService.createPlaylist(name, 'Created from QueueBoard');

      // Insert at the top of playlists and reapply sort
      const curr = [...this.playlists()];
      curr.unshift(created);
      const sorted = this.playlistService.applySort(curr);
      this.playlists.set(sorted);

      // Reset UI
      this.newPlaylistName.set('');
      this.showAddPlaylist.set(false);
      this.saveState();
    } catch (e: any) {
      console.error('Failed to create playlist', e);
      this.error.set(e?.message || String(e));
    } finally {
      this.connecting.set(false);
    }
  }

  private extractVideoId(input: string): string | null {
    if (!input) return null;
    const trimmed = input.trim();
    // If it looks like a raw video id (11 chars typical for YouTube IDs)
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

    try {
      const url = new URL(trimmed);
      // youtu.be short links
      if (url.hostname.includes('youtu.be')) {
        const parts = url.pathname.split('/').filter(Boolean);
        return parts.length ? parts[0] : null;
      }
      // Regular watch?v=VIDEOID
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      // Some embed URLs or /v/VIDEOID
      const pathParts = url.pathname.split('/').filter(Boolean);
      const maybe = pathParts[pathParts.length - 1];
      if (maybe && /^[a-zA-Z0-9_-]{11}$/.test(maybe)) return maybe;
    } catch (e) {
      // Not a URL - fall through
    }

    return null;
  }

  async addVideoToPlaylistUI(playlistId: string, urlOrId: string) {
    if (!urlOrId) return;
    const videoId = this.extractVideoId(urlOrId) || urlOrId.trim();
    if (!videoId) {
      this.error.set('Could not parse a YouTube video id from the provided value.');
      return;
    }

    // mark this playlist as adding
    this.addVideoLoading.update((m) => ({ ...(m || {}), [playlistId]: true }));
    try {
      if (this.youtube.isAuthenticated && this.youtube.isAuthenticated()) {
        // Attempt to insert on YouTube
        await this.youtube.addVideoToPlaylist(playlistId, videoId);

        // Refresh playlist items for this playlist
        try {
          const { items } = await this.youtube.fetchPlaylistItems(playlistId, 50);
          const mapped = (items as any[]).map((v: any) => ({
            id: v.contentDetails?.videoId || '',
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
          }));

          const curr = [...this.playlists()];
          const idx = curr.findIndex((p) => p.id === playlistId);
          if (idx >= 0) {
            curr[idx] = { ...curr[idx], videos: mapped };
            this.playlists.set(curr);
            this.playlistService.updatePlaylistModified(playlistId);
            this.saveState();
          }
        } catch (e) {
          console.error('Failed to refresh playlist items after add', e);
        }
      } else {
        // Not authenticated - add a local placeholder entry so user sees the video in UI
        // Try to fetch metadata (title/thumbnail/duration) using API key if available
        let metadata: any = null;
        try {
          metadata = await this.youtube.fetchVideoMetadata(videoId);
        } catch (e) {
          // ignore metadata fetch failure
        }

        const newVideo: VideoCard = {
          id: videoId,
          playlistItemId: 'local-' + Date.now().toString(36),
          title: metadata?.snippet?.title || videoId,
          description: metadata?.snippet?.description || '',
          duration: this.youtube.isoDurationToString(metadata?.contentDetails?.duration || ''),
          thumbnail: metadata?.snippet?.thumbnails?.default?.url || '',
          youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };

        const curr = [...this.playlists()];
        const idx = curr.findIndex((p) => p.id === playlistId);
        if (idx >= 0) {
          const updated = { ...curr[idx], videos: [...(curr[idx].videos || []), newVideo] };
          curr[idx] = updated;
          this.playlists.set(curr);
          this.playlistService.updatePlaylistModified(playlistId);
          this.saveState();
        }
      }
    } catch (err: any) {
      console.error('Failed to add video to playlist', err);
      this.error.set(err?.message || String(err));
    } finally {
      // clear loading for this playlist
      this.addVideoLoading.update((m) => ({ ...(m || {}), [playlistId]: false }));
      // close input
      this.addVideoVisible.update((m) => ({ ...(m || {}), [playlistId]: false }));
    }
  }

  private loadState(): PlaylistColumn[] | null {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    try {
      const saved = localStorage.getItem('queueboard_state');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.warn('Failed to load state:', e);
      return null;
    }
  }

  private saveState(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('queueboard_state', JSON.stringify(this.playlists()));
    } catch (e) {
      console.warn('Failed to save state:', e);
    }
  }

  // Dark mode functionality
  private initializeDarkMode(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

    // Check for saved preference
    const savedDarkMode = localStorage.getItem('queueboard_dark_mode');

    if (savedDarkMode !== null) {
      // Use saved preference
      this.isDarkMode.set(savedDarkMode === 'true');
    } else {
      // Fall back to system preference
      const prefersDark =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.isDarkMode.set(prefersDark);
    }

    // Apply the dark mode class
    this.applyDarkMode();
  }

  toggleDarkMode(): void {
    const newDarkMode = !this.isDarkMode();
    console.log('Toggle dark mode:', { from: this.isDarkMode(), to: newDarkMode });
    this.isDarkMode.set(newDarkMode);

    // Save preference
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('queueboard_dark_mode', String(newDarkMode));
      console.log('Saved to localStorage:', localStorage.getItem('queueboard_dark_mode'));
    }

    // Apply the change
    this.applyDarkMode();
  }

  private applyDarkMode(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const body = document.body;
    const isDark = this.isDarkMode();
    console.log('Apply dark mode:', { isDark, bodyClasses: body.classList.toString() });

    if (isDark) {
      body.classList.add('dark-mode');
    } else {
      body.classList.remove('dark-mode');
    }

    console.log('After applying:', { bodyClasses: body.classList.toString() });
  }
}
