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
import { YoutubeApiService } from '../shared/services/youtube-api.service';
import {
  NormalizedPlaylistVideo,
  YouTubePlaylist,
  YouTubePlaylistItem,
} from '../shared/services/youtube-api.types';
import { environment } from '../../env/environment';
import { VideoPlayerComponent } from './video-player/video-player.component';
import { MinimizedVideosComponent } from './minimized-videos/minimized-videos.component';
import { PollingService } from '../services/PollingService';
import { StorageService } from '../services/StorageService';
import { LOCAL_STORAGE_KEYS as StorageKey, LocalStorageKey } from '../services/local-storage-keys';
import { ErrorHandlerService, AppError, ErrorSeverity } from '../services/ErrorHandlerService';
import { ToastService } from '../services/toast.service';
import { PlayerManagerService } from '../services/PlayerManagerService';
import { InputSanitizerService } from '../services/InputSanitizerService';
import { PlaylistColumn, PlaylistService, VideoCard } from '../services/playlist.service';
import { SortService } from '../services/sort.service';
import { PlaylistSortOrder, PLAYLIST_SORT_ORDER } from '../types/sort.types';
import { ThemeService } from '../services/theme.service';
import { WelcomeScreenComponent } from './welcome-screen/welcome-screen.component';
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
    WelcomeScreenComponent,
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
  searchFilter = signal<'all' | 'list' | 'video'>('all');
  filteredPlaylists = computed(() => {
    const q = (this.search || '').trim().toLowerCase();
    const filter = this.searchFilter();
    let filtered = this.playlists();

    if (q) {
      const matchText = (text?: string) => (text || '').toLowerCase().includes(q);

      filtered = this.playlists()
        .map((pl) => {
          const playlistTitleMatches = matchText(pl.title) || matchText(pl.description);

          const matchingVideos = (pl.videos || []).filter(
            (v) =>
              matchText(v.title) ||
              matchText(v.description) ||
              (v.tags && v.tags.some((t) => matchText(t))) ||
              matchText(v.channelTitle),
          );

          if (filter === 'list') {
            return playlistTitleMatches ? pl : null;
          }

          if (filter === 'video') {
            return matchingVideos.length > 0 ? { ...pl, videos: matchingVideos } : null;
          }

          // filter === 'all'
          if (playlistTitleMatches) {
            return pl;
          }
          if (matchingVideos.length > 0) {
            return { ...pl, videos: matchingVideos };
          }

          return null;
        })
        .filter((x): x is PlaylistColumn => x !== null);
    }

    // Apply sorting using SortService. For custom order, first apply stored custom order.
    let sorted: PlaylistColumn[];
    if (this.currentSortOrder() === PLAYLIST_SORT_ORDER.CUSTOM) {
      // Ensure playlists appear in persisted custom order even after fetch/refresh
      sorted = this.sortService.applyCustomSort(filtered);
    } else {
      sorted = this.sortService.sortPlaylists(filtered, this.currentSortOrder());
    }

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
    () => this.playlists().length > 0 && this.playlists()[0]?.id !== 'loading',
  );
  connecting = signal(false);
  error = signal<string | null>(null);
  loadingMore = signal(false);
  authenticated = signal(false);
  toast = inject(ToastService); // public for template access

  // Sort-related properties
  currentSortOrder = signal<PlaylistSortOrder>(PLAYLIST_SORT_ORDER.CUSTOM);

  get sortOptions() {
    return this.sortService.sortOptions;
  }

  // Add playlist UI state
  showAddPlaylist = signal(false);
  newPlaylistName = signal('');
  // Per-playlist add-video UI state (visibility)
  addVideoVisible = signal<Record<string, boolean>>({});
  // per-playlist adding indicator
  addVideoLoading = signal<Record<string, boolean>>({});

  // Theme (dark mode) handled by ThemeService
  private theme = inject(ThemeService);
  themeInitialized = signal(false);

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

  ngOnDestroy(): void {
    clearInterval(this.pollingInterval);
  }

  /**
   * Ensures all video data for all playlists is loaded when the search input is focused.
   * This is a proactive measure to guarantee comprehensive search results, but it only
   * fetches videos if they haven't been preloaded already, making it efficient.
   */
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
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // If the '/' key is pressed and the search input exists, focus it.
    if (event.key === '/' && this.searchInput) {
      event.preventDefault(); // Prevent the '/' character from being typed
      this.searchInput.nativeElement.focus();
    }
  }

  async ngOnInit(): Promise<void> {
    // Load YouTube IFrame API
    if (isPlatformBrowser(this.platformId)) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }

    // Initialize theme service
    this.theme.init();
    this.themeInitialized.set(true);

    // Load saved sort order using SortService (which uses StorageService)
    const savedSortOrder = this.sortService.loadSortOrder();
    this.currentSortOrder.set(savedSortOrder);

    const saved = await this.storage.getPlaylists();

    if (saved) {
      this.playlists.set(saved);
    } else {
      // No saved state - show loading
      this.playlists.set([
        {
          id: 'loading',
          title: '',
          description: '',
          color: '#fff',
          publishedAt: 0,
          lastUpdated: 0,
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

    // Attempt silent auth restoration (loads gapi/gis and restores token if present)
    this.attemptSilentAuth();
  }

  async connectYouTube() {
    // If already authenticated, just ensure playlists are loaded and bail.
    if (this.authenticated()) {
      if (!this.hasPlaylists()) {
        this.refresh();
      } else {
        this.toast.show('Already connected', ErrorSeverity.INFO, 2000);
      }
      return;
    }
    this.error.set(null);
    this.connecting.set(true);
    try {
      await this.youtube.load();
      const token = await this.youtube.requestAccessToken();
      if (!token) {
        const appErr = this.errorHandler.handleError('User did not grant access', 'auth');
        this.toast.show(appErr.message, appErr.severity);
        return;
      }
      await this._fetchAndProcessPlaylists();
      this.authenticated.set(true);
      if (this.pollingInterval) clearInterval(this.pollingInterval);
      this.pollingInterval = setInterval(
        () => this.refresh(),
        environment.pollingIntervalMinutes * 60 * 1000,
      );
    } catch (err) {
      const appErr = this.errorHandler.handleYouTubeError(err, 'connectYouTube');
      this.toast.show(appErr.message, appErr.severity);
    } finally {
      this.connecting.set(false);
    }
  }

  async refresh() {
    this.error.set(null);
    this.connecting.set(true);
    try {
      await this._fetchAndProcessPlaylists();
    } catch (err) {
      const appErr = this.errorHandler.handleYouTubeError(err, 'refreshPlaylists');
      this.toast.show(appErr.message, appErr.severity);
    } finally {
      this.connecting.set(false);
    }
  }

  private async _fetchAndProcessPlaylists(): Promise<void> {
    // Fetch all playlists at once
    // TODO: Re-enable pagination by passing pageToken
    const { playlists } = await this.playlistService.fetchAndMergePlaylists(250);
    // Sorting handled exclusively by SortService; legacy manual sort initialization removed.

    // nextPageToken tracking disabled for now
    this.playlistService.nextPageToken = undefined;
    this.preloadedAllVideos = false;

    // Fetch videos for each playlist
    const playlistsWithVideos = await Promise.all(
      playlists.map(async (pl) => {
        if (pl.videos && pl.videos.length > 0) {
          return pl; // Videos already exist, no need to fetch
        }
        try {
          // Fetch all videos at once - pagination disabled
          const { items } = await this.youtube.fetchPlaylistItems(pl.id, 250);
          const mappedVideos: VideoCard[] = (items as YouTubePlaylistItem[]).map(
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
            }),
          );

          return { ...pl, videos: mappedVideos };
        } catch (e) {
          console.error('Failed to load playlist items for', pl.id, e);
          return pl; // Return the playlist without videos on error
        }
      }),
    );

    // Set the playlists signal once with all the data
    this.playlists.set(playlistsWithVideos);

    // Save the final state to storage
    this.storage.savePlaylists(this.playlists());
  }

  async fetchMorePlaylists() {
    // Pagination disabled - this method is kept for future use
    // TODO: Re-enable by checking nextPageToken and using it for pagination
    console.log(
      'FetchMorePlaylists disabled - pagination removed. All playlists are loaded initially.',
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
    } catch (e: any) {
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

      this.storage.savePlaylists(this.playlists());
    } catch (e) {
      console.error('Failed to load more videos for playlist', playlist.id, e);
    }
    */
  }

  openVideo(v: VideoCard) {
    this.playerManager.open(v);
    // Temporary bridge until local signals removed:
    this.selectedVideo.set(this.playerManager.selectedVideo());
  }

  minimizeVideo() {
    this.playerManager.minimize();
    this.selectedVideo.set(this.playerManager.selectedVideo());
    this.minimizedVideos.set(this.playerManager.minimizedVideos());
  }

  restoreVideo(v: VideoCard) {
    this.playerManager.restore(v.id);
    this.selectedVideo.set(this.playerManager.selectedVideo());
    this.minimizedVideos.set(this.playerManager.minimizedVideos());
  }

  closeVideo(video?: VideoCard) {
    this.playerManager.close(video?.id);
    this.selectedVideo.set(this.playerManager.selectedVideo());
    this.minimizedVideos.set(this.playerManager.minimizedVideos());
  }

  togglePlayPause(video: VideoCard) {
    this.playerManager.togglePlayPause(video.id);
    this.playerState.set(this.playerManager.playerState());
  }

  onPlayerReady(e: YT.PlayerEvent) {
    const id = new URL(e.target.getVideoUrl()).searchParams.get('v');
    if (!id) return;
    this.playerManager.registerPlayer(id, e.target);
    this.playerReady.set(this.playerManager.playerReady());
  }

  onPlayerStateChange(e: YT.PlayerEvent) {
    // Use service helper to update player state signal
    this.playerManager.setPlayerState(e.data);
    this.playerState.set(this.playerManager.playerState());
  }

  drop(event: CdkDragDrop<VideoCard[]>) {
    if (!event.previousContainer || !event.container) return;

    const currentTime = new Date().toISOString();
    const curr = [...this.playlists()];

    if (event.previousContainer === event.container) {
      // Moving within same playlist
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      const videoToMove = event.previousContainer.data[event.previousIndex];
      const sourcePlaylistId = event.previousContainer.id;
      const destPlaylistId = event.container.id;

      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );

      this.syncMove(videoToMove, sourcePlaylistId, destPlaylistId).catch((err) => {
        console.error('Failed to sync video move with YouTube:', err);
        const appErr = this.errorHandler.handleError(err, 'moveVideo');
        const msg = `Failed to move video: ${err?.message || String(err)}`;
        this.toast.show(msg, appErr.severity);
      });
    }
    this.storage.savePlaylists(this.playlists());
  }

  private async syncMove(video: VideoCard, sourcePlaylistId: string, destPlaylistId: string) {
    if (!video.playlistItemId) throw new Error('Cannot move video: missing playlistItemId.');
    if (!video.id) throw new Error('Cannot move video: missing videoId.');

    await this.youtube.removeVideoFromPlaylist(video.playlistItemId);
    await this.youtube.addVideoToPlaylist(destPlaylistId, video.id);
  }

  dropPlaylist(event: CdkDragDrop<PlaylistColumn[]>) {
    const searchActive = (this.search || '').trim().length > 0;
    const mode = this.currentSortOrder();
    const raw = [...this.playlists()];
    const visible = [...this.filteredPlaylists()];

    if (!searchActive) {
      let working = mode === PLAYLIST_SORT_ORDER.CUSTOM ? raw : visible;
      moveItemInArray(working, event.previousIndex, event.currentIndex);
      const cleaned = working.filter((p) => p.id !== 'load-more-sentinel' && p.id !== 'loading');
      this.sortService.saveCustomSortOrder(cleaned.map((p) => p.id));
      this.playlists.set(working);
      if (mode !== PLAYLIST_SORT_ORDER.CUSTOM) {
        this.currentSortOrder.set(PLAYLIST_SORT_ORDER.CUSTOM);
        this.sortService.saveSortOrder(PLAYLIST_SORT_ORDER.CUSTOM);
      }
      this.storage.savePlaylists(this.playlists());
      return;
    }

    // Search-active partial reorder:
    // Reorder only the visible subset, then merge back with unaffected playlists.
    const subset = [...visible];
    moveItemInArray(subset, event.previousIndex, event.currentIndex);
    const subsetIds = new Set(subset.map((p) => p.id));
    const unaffected = raw.filter((p) => !subsetIds.has(p.id));

    // Merge strategy: keep reordered subset at top followed by unaffected in original order.
    // Future enhancement: maintain original relative gap positions.
    const merged = [...subset, ...unaffected];
    const cleanedMerged = merged.filter((p) => p.id !== 'load-more-sentinel' && p.id !== 'loading');
    this.sortService.saveCustomSortOrder(cleanedMerged.map((p) => p.id));
    this.playlists.set(merged);
    if (mode !== PLAYLIST_SORT_ORDER.CUSTOM) {
      this.currentSortOrder.set(PLAYLIST_SORT_ORDER.CUSTOM);
      this.sortService.saveSortOrder(PLAYLIST_SORT_ORDER.CUSTOM);
    }
    this.storage.savePlaylists(this.playlists());
  }

  trackById(index: number, item: any) {
    return item.id;
  }

  toggleDetails(video: VideoCard) {
    video.detailsVisible = !video.detailsVisible;
  }

  onSortOrderChange(sortOrder: PlaylistSortOrder) {
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

      // Insert at the top of playlists; sorting handled by computed filteredPlaylists
      const curr = [...this.playlists()];
      curr.unshift(created);
      this.playlists.set(curr);
      // If currently in custom mode, persist updated order including new playlist at front
      if (this.currentSortOrder() === PLAYLIST_SORT_ORDER.CUSTOM) {
        this.sortService.updateCustomSortAfterDrop(this.playlists());
      }

      // Reset UI
      this.newPlaylistName.set('');
      this.showAddPlaylist.set(false);
      this.storage.savePlaylists(this.playlists());
    } catch (e) {
      console.error('Failed to create playlist', e);
      const appErr = this.errorHandler.handleYouTubeError(e, 'createPlaylist');
      this.toast.show(appErr.message, appErr.severity);
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
      const appErr = this.errorHandler.handleError(
        'Could not parse a YouTube video id from the provided value.',
        'addVideo',
      );
      this.toast.show(appErr.message, appErr.severity);
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
            this.storage.savePlaylists(this.playlists());
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
          this.storage.savePlaylists(this.playlists());
        }
      }
    } catch (err) {
      console.error('Failed to add video to playlist', err);
      const appErr = this.errorHandler.handleYouTubeError(err, 'addVideoToPlaylist');
      this.toast.show(appErr.message, appErr.severity);
    } finally {
      // clear loading for this playlist
      this.addVideoLoading.update((m) => ({ ...(m || {}), [playlistId]: false }));
      // close input
      this.addVideoVisible.update((m) => ({ ...(m || {}), [playlistId]: false }));
    }
  }

  // Removed private loadState() and saveState() methods.
  // Playlist state is now managed by calling this.storage.getPlaylists() and this.storage.savePlaylists().

  // Dark mode delegated to ThemeService
  toggleDarkMode(): void {
    this.theme.toggle();
  }
  isDarkMode(): boolean {
    return this.theme.darkMode();
  }

  async signOut(): Promise<void> {
    this.youtube.signOut();
    this.authenticated.set(false);
    this.playlists.set([]);
    try {
      await this.storage.clear();
    } catch {}
    this.toast.show('Signed out', ErrorSeverity.INFO, 2500);
  }

  private attemptSilentAuth() {
    if (!isPlatformBrowser(this.platformId)) return;
    // Load scripts + restore token (load is idempotent)
    this.youtube
      .load()
      .then(() => {
        if (this.youtube.isAuthenticated()) {
          this.authenticated.set(true);
          const playlistsLoaded =
            this.playlists().length > 0 && this.playlists()[0]?.id !== 'loading';
          // If no playlists loaded yet, fetch them silently
          if (!playlistsLoaded) {
            this.connecting.set(true);
            this._fetchAndProcessPlaylists()
              .catch((err) => {
                const appErr = this.errorHandler.handleYouTubeError(err, 'silentAuthLoad');
                this.toast.show(appErr.message, appErr.severity);
              })
              .finally(() => this.connecting.set(false));
          }
          this.toast.show('Session restored', ErrorSeverity.INFO, 2500);
        }
      })
      .catch(() => {
        // Ignore silent auth failures; user can still click Connect
      });
  }

  // Legacy toast API removed; using ToastService
}
