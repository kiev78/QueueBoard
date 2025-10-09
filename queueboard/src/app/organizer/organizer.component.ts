import { Component, OnInit, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { YoutubeApiService } from '../services';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

interface VideoCard {
  id: string;
  title: string;
  description?: string;
  duration?: string;
  thumbnail?: string;
  tags?: string[];
  channelTitle?: string;
  publishedAt?: string;
  youtubeUrl?: string;
}

interface PlaylistColumn {
  id: string;
  title: string;
  description?: string;
  color?: string;
  videos: VideoCard[];
  nextPageToken?: string;
}

@Component({
  selector: 'app-organizer',
  standalone: true,
  imports: [CommonModule, RouterModule, DragDropModule, FormsModule],
  templateUrl: './organizer.component.html',
  styleUrls: ['./organizer.component.scss']
})
export class OrganizerComponent implements OnInit {
  playlists = signal<PlaylistColumn[]>([]);
  search = signal('');
  private preloadedAllVideos = false;
  preloading = signal(false);
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
      return [...filtered, { id: 'load-more-sentinel', title: 'Next', videos: [] }];
    }
    return filtered;
  });
  connecting = signal(false);
  error = signal<string | null>(null);
  loadingMore = signal(false);

  selectedVideo = signal<VideoCard | null>(null);
  embedUrl = signal<SafeResourceUrl | null>(null);

  private sanitizer = inject(DomSanitizer);
  private nextPageToken: string | null | undefined = undefined;

  constructor(public youtube: YoutubeApiService) {}

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
          id: v.id || v.videoId || v.snippet?.resourceId?.videoId || '',
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
    } else {
      // seed with example data for now
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
            // SVG spinner markup as a string (can be rendered in template)
            description: `
             Loading...
            `
          }
        ]
      }
    ]);
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
            id: v.id || v.videoId || v.snippet?.resourceId?.videoId || '',
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
            id: v.id || v.videoId || v.snippet?.resourceId?.videoId || '',
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
        id: v.id || v.videoId || v.snippet?.resourceId?.videoId || '',
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
 

  openVideo(v: VideoCard) {
    this.selectedVideo.set(v);
    const id = v.id;
    const url = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
    this.embedUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
  }

  closeVideo() {
    this.selectedVideo.set(null);
    this.embedUrl.set(null);
  }

  drop(event: CdkDragDrop<VideoCard[]>, playlistId?: string) {
    if (!event.previousContainer || !event.container) return;

    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
    }
    // persist order after any change
    this.saveState();
  }

  dropPlaylist(event: CdkDragDrop<PlaylistColumn[]>) {
    const arr = [...this.playlists()];
    moveItemInArray(arr, event.previousIndex, event.currentIndex);
    this.playlists.set(arr);
    this.saveState();
  }

  trackById(index: number, item: any) {
    return item.id;
  }

  private saveState(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('queueboard_state_v1', JSON.stringify(this.playlists()));
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
}
