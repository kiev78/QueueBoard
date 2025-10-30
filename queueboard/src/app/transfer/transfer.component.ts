import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { YoutubeApiService } from '../shared/services/youtube-api.service';
import { YouTubeSearchResult } from '../shared/services/youtube-api.types';
import { StorageService } from '../services/StorageService';
import { PlaylistColumn } from '../services/playlist.service';
import { PlaylistService } from '../services/playlist.service';
import { ThemeService } from '../services/theme.service';
import { ToastService } from '../services/toast.service';
import { ErrorSeverity } from '../services/ErrorHandlerService';

@Component({
  selector: 'app-transfer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transfer.component.html',
  styleUrls: ['./transfer.component.scss'],
})
export class TransferComponent implements OnInit {
  private youtube = inject(YoutubeApiService);
  private storage = inject(StorageService);
  private playlistSvc = inject(PlaylistService);
  private theme = inject(ThemeService);
  private toast = inject(ToastService);
  private platformId = inject(PLATFORM_ID);

  connecting = signal(false);
  trans_google = signal(false);
  trans_spotify = signal(false); // Added for future use

  googlePlaylists = signal<PlaylistColumn[]>([]);
  searchQuery = signal('');
  searchResults = signal<YouTubeSearchResult[]>([]);
  playlistSearchQuery = signal('');

  filteredGooglePlaylists = computed(() => {
    const query = (this.playlistSearchQuery() || '').toString().trim().toLowerCase();
    if (!query) return this.googlePlaylists();
    return this.googlePlaylists().filter((p) => p.title?.toLowerCase().includes(query));
  });

  // Track which playlists are currently loading their videos
  loadingVideos = signal<Record<string, boolean>>({});
  // Track which playlists are expanded (videos visible). Starts compact by default.
  expandedPlaylists = signal<Record<string, boolean>>({});

  ngOnInit(): void {
    // Prefer playlists persisted in IndexedDB via StorageService
    (async () => {
      const pls = await this.storage.getPlaylists();
      if (pls && pls.length > 0) {
        this.googlePlaylists.set(pls);
        this.trans_google.set(true);
        return; // already loaded from storage
      }
      // If nothing persisted but user already authenticated (e.g., came from Organizer)
      try {
        // Only attempt to load browser-only scripts when running in the browser
        if (!isPlatformBrowser(this.platformId)) {
          return;
        }
        // show loading toast while silently fetching (dismissed with success/failure)
        this.toast.show('Checking for playlists…', ErrorSeverity.INFO, 60000);
        await this.youtube.load();
        if (this.youtube.isAuthenticated()) {
          const fetched = await this.youtube.fetchPlaylists();
          const mapped: PlaylistColumn[] = (fetched.items || []).map((p: any) => ({
            id: p.id,
            title: p.snippet?.title || '',
            description: p.snippet?.description || '',
            color: '#e0e0e0',
            videos: [],
            publishedAt: p.snippet?.publishedAt ? new Date(p.snippet.publishedAt).getTime() : 0,
            lastUpdated: Date.now(),
          }));
          if (mapped.length > 0) {
            this.googlePlaylists.set(mapped);
            await this.storage.savePlaylists(mapped);
            this.trans_google.set(true);
            this.toast.show('Playlists restored from your account', ErrorSeverity.INFO, 3000);
          } else {
            this.toast.show('No playlists found in your account', ErrorSeverity.WARNING, 2500);
          }
        }
      } catch (e) {
        console.warn('Silent playlist fetch failed', e);
        this.toast.show('Could not silently load playlists', ErrorSeverity.WARNING, 3000);
      }
    })();
  }

  /**
   * Explicitly load playlists saved in storage. This is manual so Transfer does not
   * implicitly pick up updates from Organizer refreshes.
   */
  async loadSavedPlaylists(): Promise<void> {
    try {
      this.connecting.set(true);
      const loadingId = 'transfer-load-' + Date.now().toString(36);
      // show a short-lived loading toast (we'll dismiss it when done)
      this.toast.show('Loading saved playlists…', ErrorSeverity.INFO, 60000);
      const pls = await this.storage.getPlaylists();
      if (pls && pls.length > 0) {
        this.googlePlaylists.set(pls);
        this.trans_google.set(true);
        this.toast.show('Loaded saved playlists', ErrorSeverity.INFO, 2500);
      } else {
        // No playlists in storage — clear any previously shown data
        this.googlePlaylists.set([]);
        this.trans_google.set(false);
        this.toast.show('No saved playlists found', ErrorSeverity.WARNING, 2500);
      }
    } catch (err) {
      console.error('Failed to load saved playlists', err);
      this.toast.show('Failed to load saved playlists', ErrorSeverity.ERROR, 4000);
    } finally {
      this.connecting.set(false);
    }
  }

  async connectGoogle() {
    this.connecting.set(true);
    try {
      await this.youtube.load();
      const token = await this.youtube.requestAccessToken();
      if (token) {
        const playlists = await this.youtube.fetchPlaylists();
        // Map to internal PlaylistColumn shape (no videos yet)
        const mapped: PlaylistColumn[] = (playlists.items || []).map((p: any) => ({
          id: p.id,
          title: p.snippet?.title || '',
          description: p.snippet?.description || '',
          color: '#e0e0e0',
          videos: [],
          publishedAt: p.snippet?.publishedAt ? new Date(p.snippet.publishedAt).getTime() : 0,
          lastUpdated: Date.now(),
        }));

        this.googlePlaylists.set(mapped);
        if (mapped.length > 0) {
          // Persist playlists into storage (IndexedDB preferred)
          await this.storage.savePlaylists(mapped);
        }
        this.trans_google.set(true);
      }
    } catch (error) {
      console.error('Failed to connect to Google', error);
    } finally {
      this.connecting.set(false);
    }
  }

  // Lazily load videos for a playlist when user clicks "Load videos".
  // Keeps the UI compact until the user explicitly expands a playlist.
  async loadVideosForPlaylist(playlistId: string) {
    // Toggle expansion when videos are already loaded
    const currExpanded = { ...(this.expandedPlaylists() || {}) };
    const alreadyExpanded = !!currExpanded[playlistId];

    // If already expanded, just collapse
    if (alreadyExpanded) {
      currExpanded[playlistId] = false;
      this.expandedPlaylists.set(currExpanded);
      return;
    }

    // Otherwise, attempt to load videos (if not already present)
    const current = [...this.googlePlaylists()];
    const idx = current.findIndex((p) => p.id === playlistId);
    if (idx === -1) return;

    // If videos already loaded, just expand
    if (current[idx].videos && current[idx].videos.length > 0) {
      currExpanded[playlistId] = true;
      this.expandedPlaylists.set(currExpanded);
      return;
    }

    // Set per-playlist loading state
    this.loadingVideos.update((m) => ({ ...(m || {}), [playlistId]: true }));
    const loadingToastId = 'transfer-load-videos-' + playlistId + '-' + Date.now().toString(36);
    this.toast.show('Loading videos…', ErrorSeverity.INFO, 60000);

    try {
      const updated = await this.playlistSvc.fetchAllPlaylistItems([current[idx]]);
      if (updated && updated.length > 0) {
        current[idx] = updated[0];
        this.googlePlaylists.set(current);
        // Persist playlists (now with videos) to storage
        await this.storage.savePlaylists(current);
        // Mark expanded so UI shows numeric list
        currExpanded[playlistId] = true;
        this.expandedPlaylists.set(currExpanded);
        this.toast.show('Videos loaded', ErrorSeverity.INFO, 2000);
      } else {
        this.toast.show('No videos found for playlist', ErrorSeverity.WARNING, 2500);
      }
    } catch (err) {
      console.error('Failed to load videos for playlist', playlistId, err);
      this.toast.show('Failed to load videos', ErrorSeverity.ERROR, 4000);
    } finally {
      this.loadingVideos.update((m) => ({ ...(m || {}), [playlistId]: false }));
    }
  }

  async search() {
    if (!this.searchQuery()) {
      return;
    }
    const results = await this.youtube.searchMusicVideos(this.searchQuery());
    this.searchResults.set(results.items);
  }

  // Proxy to ThemeService so the template can toggle and read dark mode
  toggleDarkMode(): void {
    this.theme.toggle();
  }

  isDarkMode(): boolean {
    return this.theme.darkMode();
  }

  // trackBy helper for ngFor to ensure stable rendering
  // Accept `any` so it can be used for playlists and videos (different shapes)
  trackById(index: number, item: any): any {
    return item?.id;
  }
}
