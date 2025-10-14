import { Component, OnInit, OnDestroy, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { YoutubeApiService } from '../services';
import { environment } from '../../env/environment';

interface VideoCard {
  playlistItemId: string; // The ID of the item in the playlist, needed for removal
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
  player?: YT.Player;
  isPlaying?: boolean;
  setSize?: (width: number, height: number) => void;
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
  imports: [CommonModule, RouterModule, DragDropModule, FormsModule],
  templateUrl: './organizer.component.html',
  styleUrls: ['./organizer.component.scss']
})
export class OrganizerComponent implements OnInit, OnDestroy {
  playlists = signal<PlaylistColumn[]>([]);
  playlistsSort: PlaylistSort[] = [];
  search = signal('');
  private preloadedAllVideos = false;
  preloading = signal(false);
  loadMoreSentinelId = 'load-more-sentinel';
  filteredPlaylists = computed(() => {
    const q = (this.search() || '').trim().toLowerCase();
    let filtered = this.playlists();

    if (q) {
      const matchText = (text?: string) => (text || '').toLowerCase().includes(q);
      filtered = this.playlists()
        .map((pl) => {
          // filter videos inside playlist
          const videos = (pl.videos || []).filter((v) => {
            if (matchText(v.title)) return true;
            if (matchText(v.description)) return true;
            if (v.tags && v.tags.some((t: string) => matchText(t))) return true;
            if (matchText(v.channelTitle)) return true;
            return false;
          });

          const playlistMatches = matchText(pl.title) || matchText(pl.description);
          if (playlistMatches) {
            // show all videos if playlist matches
            return { ...pl, videos: pl.videos } as PlaylistColumn;
          }

          // only include playlist if some videos matched
          if (videos.length > 0) {
            return { ...pl, videos } as PlaylistColumn;
          }

          return null;
        })
        .filter((x): x is PlaylistColumn => x !== null);
    }

    if (this.nextPageToken) {
      return [...filtered, { id: this.loadMoreSentinelId, title: 'Next', videos: [] }];
    }
    return filtered;
  });
  hasPlaylists = computed(() => this.playlists().length > 0 && this.playlists()[0]?.id !== 'loading');
  connecting = signal(false);
  error = signal<string | null>(null);
  loadingMore = signal(false);

  playingVideos = signal<VideoCard[]>([]);
  minimizedVideos = signal<VideoCard[]>([]);

  private isYouTubeApiLoaded = false;
  private nextPageToken: string | null | undefined = undefined;
  private pollingInterval: any;

  constructor(public youtube: YoutubeApiService) { }

  // Called when the search input is focused/clicked. Start preloading videos
  // from all playlists (first time only) so the search can match video content.
  onSearchFocus() {
    if (this.preloadedAllVideos || this.preloading()) return;
    this.preloading.set(true);
    this.fetchAllPlaylistItems(25)
      .catch((e) => console.error('Failed to preload playlist items', e))
      .finally(() => this.preloading.set(false));
  }

  // Fetch items for every playlist that has empty videos and populate them.
  private async fetchAllPlaylistItems(limit = 25) {
    const pls = [...this.playlists()];
    for (const pl of pls) {
      try {
        if (pl.videos && pl.videos.length > 0) continue;
        const { items, nextPageToken } = await this.youtube.fetchPlaylistItems(pl.id, limit);

        const mapped: VideoCard[] = (items as any[]).map((v: any) => ({
          id: v.videoId,
          playlistItemId: v.id,
          title: v.snippet?.title || v.title || '',
          description: v.snippet?.description || v.description || '',
          duration: this.youtube.isoDurationToString(v.contentDetails?.duration || v.duration || ''),
          thumbnail: v.snippet?.thumbnails?.default?.url || v.thumbnail || '',
          tags: v.snippet?.tags || v.tags || [],
          channelTitle: v.snippet?.channelTitle || v.channelTitle || '',
          publishedAt: v.snippet?.publishedAt || v.publishedAt || '',
          youtubeUrl: v.youtubeUrl || (v.snippet?.resourceId?.videoId ? `https://www.youtube.com/watch?v=${v.snippet.resourceId.videoId}` : '')
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
    // Show loading spinner SVG while loading playlists
    // try restore saved state
    const saved = this.loadState();
    if (saved) {
      this.playlists.set(saved);
      this.playlistsSort = saved.filter(p => p.sortId !== undefined).map(p => ({ id: p.id, sortId: p.sortId! }));
    } else {
      const savedSort = this.loadSortState();
      if (savedSort) {
        this.playlistsSort = savedSort;
      }
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

      // Fetch playlists and merge with stored state
      const { playlists, nextPageToken } = await this.fetchAndMergePlaylists(undefined, 10);
      this.playlists.set(playlists);
      this.nextPageToken = nextPageToken;

      // For each playlist, fetch items and populate videos (only if empty)
      for (const pl of this.playlists()) {
        try {
          if (pl.videos && pl.videos.length > 0) {
            continue; // preserve stored videos
          }

          const { items, nextPageToken } = await this.youtube.fetchPlaylistItems(pl.id, 10);

          const mapped: VideoCard[] = (items as any[]).map((v: any) => ({
            id: v.videoId,
            playlistItemId: v.id,
            title: v.snippet?.title || v.title || '',
            description: v.snippet?.description || v.description || '',
            duration: this.youtube.isoDurationToString(v.contentDetails?.duration || v.duration || ''),
            thumbnail: v.snippet?.thumbnails?.default?.url || v.thumbnail || '',
            tags: v.snippet?.tags || v.tags || [],
            channelTitle: v.snippet?.channelTitle || v.channelTitle || '',
            publishedAt: v.snippet?.publishedAt || v.publishedAt || '',
            youtubeUrl: v.youtubeUrl || (v.snippet?.resourceId?.videoId ? `https://www.youtube.com/watch?v=${v.snippet.resourceId.videoId}` : '')
          }));

          // update single playlist videos in-place in signal array
          const curr = [...this.playlists()];
          const idx = curr.findIndex(x => x.id === pl.id);
          if (idx >= 0) {
            curr[idx] = { ...curr[idx], videos: mapped, nextPageToken };
            this.playlists.set(curr);
          }
        } catch (e) {
          // ignore per-playlist errors but log
          console.error('Failed to load playlist items for', pl.id, e);
        }
      }

      // save merged state locally
      this.saveState();

      // Start polling for changes
      if (this.pollingInterval) clearInterval(this.pollingInterval);
      this.pollingInterval = setInterval(() => this.refresh(), environment.pollingIntervalMinutes * 60 * 1000); // 5 minutes

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
      // This assumes the user is already authenticated.

      // 1. Fetch the very first page of playlists, ignoring any stored state.
      const { items: newPlaylistItems, nextPageToken } = await this.youtube.fetchPlaylists(undefined, 10);
      const newPlaylists: PlaylistColumn[] = (newPlaylistItems || []).map((p: any) => ({
        id: p.id,
        title: p.snippet?.title || p.title || '',
        description: p.snippet?.description || '',
        color: '#e0e0e0',
        videos: [] as VideoCard[]
      }));

      // Apply saved sort order
      if (this.playlistsSort.length > 0) {
        const sortMap = new Map(this.playlistsSort.map(s => [s.id, s.sortId]));
        newPlaylists.forEach(p => {
          p.sortId = sortMap.get(p.id);
        });
        newPlaylists.sort((a, b) => (a.sortId ?? Infinity) - (b.sortId ?? Infinity));
      }
      this.playlists.set(newPlaylists);
      this.nextPageToken = nextPageToken;
      this.preloadedAllVideos = false;

      // 2. Fetch initial videos for each new playlist.
      for (const pl of newPlaylists) {
        try {
          const { items, nextPageToken: videoNextPageToken } = await this.youtube.fetchPlaylistItems(pl.id, 10);
          const mapped: VideoCard[] = (items as any[]).map((v: any) => ({
            id: v.videoId,
            playlistItemId: v.id,
            title: v.snippet?.title || v.title || '',
            description: v.snippet?.description || v.description || '',
            duration: this.youtube.isoDurationToString(v.contentDetails?.duration || v.duration || ''),
            thumbnail: v.snippet?.thumbnails?.default?.url || v.thumbnail || '',
            tags: v.snippet?.tags || v.tags || [],
            channelTitle: v.snippet?.channelTitle || v.channelTitle || '',
            publishedAt: v.snippet?.publishedAt || v.publishedAt || '',
            youtubeUrl: v.youtubeUrl || (v.snippet?.resourceId?.videoId ? `https://www.youtube.com/watch?v=${v.snippet.resourceId.videoId}` : '')
          }));

          this.playlists.update(current =>
            current.map(p => p.id === pl.id ? { ...p, videos: mapped, nextPageToken: videoNextPageToken } : p)
          );
        } catch (e) {
          console.error('Failed to load playlist items for', pl.id, e);
        }
      }

      // 3. Overwrite the saved state with the fresh data.
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

      // Now fetch videos for the new playlists
      for (const pl of newPlaylists) {
        try {
          const { items, nextPageToken } = await this.youtube.fetchPlaylistItems(pl.id, 10);

          const mapped: VideoCard[] = (items as any[]).map((v: any) => ({
            id: v.videoId,
            playlistItemId: v.id,
            title: v.snippet?.title || v.title || '',
            description: v.snippet?.description || v.description || '',
            duration: this.youtube.isoDurationToString(v.contentDetails?.duration || v.duration || ''),
            thumbnail: v.snippet?.thumbnails?.default?.url || v.thumbnail || '',
            tags: v.snippet?.tags || v.tags || [],
            channelTitle: v.snippet?.channelTitle || v.channelTitle || '',
            publishedAt: v.snippet?.publishedAt || v.publishedAt || '',
            youtubeUrl: v.youtubeUrl || (v.snippet?.resourceId?.videoId ? `https://www.youtube.com/watch?v=${v.snippet.resourceId.videoId}` : '')
          }));

          // Update the specific playlist with its videos
          this.playlists.update(current => current.map(p => p.id === pl.id ? { ...p, videos: mapped, nextPageToken } : p));

        } catch (e) {
          // ignore per-playlist errors but log
          console.error('Failed to load playlist items for', pl.id, e);
        }
      }

      // Save the newly added playlists and videos
      this.saveState();
    } catch (err: any) {
      this.error.set(err?.message || String(err));
      this.nextPageToken = null; // Stop trying on error
    } finally {
      this.loadingMore.set(false);
    }
  }

  async loadMoreVideos(playlist: PlaylistColumn) {
    if (!playlist.nextPageToken) return;

    try {
      const { items: newVideos, nextPageToken } = await this.youtube.fetchPlaylistItems(playlist.id, 10, playlist.nextPageToken);
      const mapped: VideoCard[] = (newVideos as any[]).map((v: any) => ({
        id: v.videoId,
        playlistItemId: v.id,
        title: v.snippet?.title || v.title || '',
        description: v.snippet?.description || v.description || '',
        duration: this.youtube.isoDurationToString(v.contentDetails?.duration || v.duration || ''),
        thumbnail: v.snippet?.thumbnails?.default?.url || v.thumbnail || '',
        tags: v.snippet?.tags || v.tags || [],
        channelTitle: v.snippet?.channelTitle || v.channelTitle || '',
        publishedAt: v.snippet?.publishedAt || v.publishedAt || '',
        youtubeUrl: v.youtubeUrl || (v.snippet?.resourceId?.videoId ? `https://www.youtube.com/watch?v=${v.snippet.resourceId.videoId}` : '')
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

  private loadYouTubeApi() {
    if (this.isYouTubeApiLoaded) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode!.insertBefore(tag, firstScriptTag);
      (window as any).onYouTubeIframeAPIReady = () => {
        this.isYouTubeApiLoaded = true;
        resolve(undefined);
      };
    });
  }
  async openVideo(v: VideoCard) {
    // Prevent duplicates
    if (this.playingVideos().find(p => p.id === v.id) || this.minimizedVideos().find(p => p.id === v.id)) {
      return;
    }

    // Ensure a persistent portal slot and create a stable host for the player there.
    const slot = this.ensurePortalSlot(v);
    if (!slot) {
      // If portal isn't present, fall back to existing behavior (shouldn't happen)
      this.playingVideos.update(current => [...current, v]);
      return;
    }

    // Create a stable host element inside the portal slot for the YT.Player to attach to.
    // If a host already exists (from previous session), reuse it.
    let initialHost = slot.querySelector<HTMLElement>(`#player-${v.id}`);
    if (!initialHost) {
      initialHost = document.createElement('div');
      initialHost.id = `player-${v.id}`;
      initialHost.className = 'player-host';
      slot.appendChild(initialHost);
    }

    // Add to playing list so UI knows it's active (overlay may be created later)
    this.playingVideos.update(current => [...current, v]);

    // Create player inside the stable host in the portal
    await this.loadYouTubeApi();
    v.player = new YT.Player(initialHost.id, {
      height: '100%',
      width: '100%',
      videoId: v.id,
      playerVars: {
        autoplay: 1,
        rel: 0,
      },
      events: {
        onReady: (e) => {
          // If overlay host is present (overlay visible), move iframe there immediately
          const overlayHost = document.getElementById(`player-${v.id}`);
          if (overlayHost && overlayHost !== initialHost) {
            // move iframe into overlay host for visible playback
            overlayHost.appendChild(e.target.getIframe());
            // restore size via API
            const rect = overlayHost.getBoundingClientRect();
            // restore player pixel size to match the host
            if (rect.width && rect.height) {
              (v.player as any)?.setSize(Math.floor(rect.width), Math.floor(rect.height));
            }
          }

          e.target.getIframe()?.focus();
          v.isPlaying = true;
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            v.isPlaying = true;
          } else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
            v.isPlaying = false;
          }
        }
      },
    });
  }

  private getPortal(): HTMLElement | null {
    return document.getElementById('player-portal');
  }

  /** Create or return a stable wrapper element inside portal for this video id */
  private ensurePortalSlot(v: VideoCard): HTMLElement | null {
    const portal = this.getPortal();
    if (!portal) return null;
    let slot = portal.querySelector<HTMLElement>(`#portal-slot-${v.id}`);
    if (!slot) {
      slot = document.createElement('div');
      slot.id = `portal-slot-${v.id}`;
      slot.className = 'portal-slot';
      // Use CSS to constrain size visually in minimized state
      portal.appendChild(slot);
    }
    return slot;
  }

  /** Move the iframe into the portal slot (keeps player alive while minimized) */
  private movePlayerToPortal(v: VideoCard): void {
    const iframe = v.player?.getIframe();
    if (!iframe) return;
    const slot = this.ensurePortalSlot(v);
    if (!slot) return;
    slot.appendChild(iframe);
    // Remove any inline sizing so CSS controls layout; sizing will be handled via setSize when restoring
    iframe.style.width = '';
    iframe.style.height = '';
  }

  /** Move the iframe from portal (or anywhere) into overlay host rendered by Angular */
  private movePlayerIntoOverlay(v: VideoCard): void {
    const iframe = v.player?.getIframe();
    if (!iframe) return;
    const host = document.getElementById(`player-${v.id}`);
    if (!host) return;
    host.appendChild(iframe);
    // After DOM attach, restore player size to match host
    const rect = host.getBoundingClientRect();
    if (rect.width && rect.height) {
      (v.player as any)?.setSize(Math.floor(rect.width), Math.floor(rect.height));
    }
  }

  closeVideo(v: VideoCard) {
    v.player?.destroy();
    v.player = undefined;
    this.playingVideos.update(current => current.filter(p => p.id !== v.id));
    this.minimizedVideos.update(current => current.filter(p => p.id !== v.id));
    const slot = document.getElementById(`portal-slot-${v.id}`);
    slot?.remove();
  }

  minimizeVideo(v: VideoCard) {
    // Move iframe into portal before Angular removes overlay so the iframe is never orphaned
    if (v.player) {
      this.movePlayerToPortal(v);
    }

    // Now update signals (this removes the overlay DOM)
    this.playingVideos.update(current => current.filter(p => p.id !== v.id));
    this.minimizedVideos.update(current => [...current, v]);
  }

  restoreVideo(v: VideoCard) {
    // Add back to playing list so Angular will create the overlay host element
    this.minimizedVideos.update(current => current.filter(p => p.id !== v.id));
    this.playingVideos.update(current => [...current, v]);

    // After overlay host renders, move iframe into it
    setTimeout(() => {
      this.movePlayerIntoOverlay(v);
      // Focus the iframe
      v.player?.getIframe()?.focus();
    }, 0);
  }

  setPlaybackRate(v: VideoCard, speed: number) {
    v.player?.setPlaybackRate(speed);
  }

  togglePlayPause(v: VideoCard) {
    if (v.isPlaying) {
      v.player?.pauseVideo();
    } else {
      v.player?.playVideo();
    }
  }

  drop(event: CdkDragDrop<VideoCard[]>) {
    if (!event.previousContainer || !event.container) return;

    if (event.previousContainer === event.container) {
      // Reordering within the same list
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      // Note: Syncing reordering with YouTube API is complex and requires `playlistItems.update`.
      // For now, we only persist the order locally.
    } else {
      // Moving to a different list
      const videoToMove = event.previousContainer.data[event.previousIndex];
      const sourcePlaylistId = event.previousContainer.id;
      const destPlaylistId = event.container.id;

      // Optimistically update the UI
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );

      // Sync with YouTube API
      this.syncMove(videoToMove, sourcePlaylistId, destPlaylistId).catch(err => {
        console.error('Failed to sync video move with YouTube:', err);
        this.error.set(`Failed to move video: ${err.message || String(err)}`);
        // TODO: Consider reverting the UI change on failure
      });
    }
    // persist order after any change
    this.saveState();
  }

  private async syncMove(video: VideoCard, sourcePlaylistId: string, destPlaylistId: string) {
    if (!video.playlistItemId) throw new Error('Cannot move video: missing playlistItemId.');
    if (!video.id) throw new Error('Cannot move video: missing videoId.');

    // 1. Remove from the old playlist
    await this.youtube.removeVideoFromPlaylist(video.playlistItemId);
    // 2. Add to the new playlist
    await this.youtube.addVideoToPlaylist(destPlaylistId, video.id);
  }

  dropPlaylist(event: CdkDragDrop<PlaylistColumn[]>) {
    const arr = [...this.playlists()];
    moveItemInArray(arr, event.previousIndex, event.currentIndex);
    arr.forEach((playlist, index) => {
      playlist.sortId = index;
    });
    this.playlistsSort = arr.map(p => ({ id: p.id, sortId: p.sortId! }));
    this.playlists.set(arr);
    this.saveState();
  }

  trackById(index: number, item: any) {
    return item.id;
  }

  toggleDetails(video: VideoCard) {
    video.detailsVisible = !video.detailsVisible;
  }

  getDetails(v: VideoCard): string {
    return 'Details ' + (v.title || 'video');
  }

  getPlay(v: VideoCard): string {
    return 'Play ' + (v.title || 'video');
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
    const fetched: PlaylistColumn[] = (res?.items || []).map((p: any) => ({
      id: p.id,
      title: p.snippet?.title || p.title || '',
      description: p.snippet?.description || '',
      color: '#e0e0e0',
      videos: [] as VideoCard[]
    }));
    const nextPageToken = res?.nextPageToken;

    // merge with saved state (preserve user order and video order)
    const stored = this.loadState();
    let merged: PlaylistColumn[] = [];
    const fetchedMap = new Map(fetched.map((f: any) => [f.id, f]));

    if (stored && stored.length) {
      // On subsequent page fetches, we don't merge with stored, just return the new items.
      if (pageToken) {
        return { playlists: fetched, nextPageToken };
      }

      // Start with stored order
      merged = stored.map((s) => {
        const f = fetchedMap.get(s.id);
        if (f) {
          // update metadata but keep stored videos/order
          return { ...s, title: f.title || s.title, description: f.description || s.description, color: f.color || s.color } as PlaylistColumn;
        }
        return s;
      });

      // Prepend any fetched playlists not in stored (new playlists)
      for (const f of fetched) {
        if (!merged.find((m) => m.id === f.id)) {
          merged.unshift(f);
        }
      }
    } else {
      merged = fetched;
    }

    return { playlists: merged, nextPageToken };
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
}