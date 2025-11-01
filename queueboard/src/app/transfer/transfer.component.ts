import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { YoutubeApiService } from '../shared/services/youtube-api.service';
import { YouTubeSearchResult } from '../shared/services/youtube-api.types';
import { SpotifyApiService, SpotifyPlaylist } from '../shared/services/spotify-api.service';
import { StorageService } from '../services/StorageService';
import { IndexedDbService } from '../services/indexed-db.service';
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
  private spotify = inject(SpotifyApiService);
  private storage = inject(StorageService);
  private indexedDb = inject(IndexedDbService);
  private playlistSvc = inject(PlaylistService);
  private theme = inject(ThemeService);
  private toast = inject(ToastService);
  private platformId = inject(PLATFORM_ID);

  connecting = signal(false);
  trans_google = signal(false);
  trans_spotify = signal(false);

  googlePlaylists = signal<PlaylistColumn[]>([]);
  spotifyPlaylists = signal<PlaylistColumn[]>([]);
  searchQuery = signal('');
  searchResults = signal<YouTubeSearchResult[]>([]);
  playlistSearchQuery = signal('');

  filteredGooglePlaylists = computed(() => {
    const query = (this.playlistSearchQuery() || '').toString().trim().toLowerCase();
    if (!query) return this.googlePlaylists();
    return this.googlePlaylists().filter((p) => p.title?.toLowerCase().includes(query));
  });

  filteredSpotifyPlaylists = computed(() => {
    const query = (this.playlistSearchQuery() || '').toString().trim().toLowerCase();
    if (!query) return this.spotifyPlaylists();
    return this.spotifyPlaylists().filter((p) => p.title?.toLowerCase().includes(query));
  });

  // Track which playlists are currently loading their videos
  loadingVideos = signal<Record<string, boolean>>({});
  // Track which playlists are expanded (videos visible). Starts compact by default.
  expandedPlaylists = signal<Record<string, boolean>>({});

  ngOnInit(): void {
    // Prefer playlists persisted in IndexedDB via StorageService
    (async () => {
      // Load Google playlists
      const pls = await this.storage.getPlaylists('google');
      if (pls && pls.length > 0) {
        this.googlePlaylists.set(pls);
        this.trans_google.set(true);
      }

      // Load Spotify playlists
      const spotifyPls = await this.storage.getPlaylists('spotify');
      if (spotifyPls && spotifyPls.length > 0) {
        this.spotifyPlaylists.set(spotifyPls);
        this.trans_spotify.set(true);
      } else if (this.spotify.isAuthenticated()) {
        // If Spotify is authenticated but no playlists cached, try to load them
        try {
          this.toast.show('Loading Spotify playlists…', ErrorSeverity.INFO, 10000);
          await this.connectSpotify();
        } catch (error) {
          console.error('Failed to auto-load Spotify playlists:', error);
        }
      }

      // If nothing persisted but user already authenticated (e.g., came from Organizer)
      if ((!pls || pls.length === 0) && (!spotifyPls || spotifyPls.length === 0)) {
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
              await this.storage.savePlaylists(mapped, 'google');
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
      // show a short-lived loading toast (we'll dismiss it when done)
      this.toast.show('Loading saved playlists…', ErrorSeverity.INFO, 60000);

      // Load Google playlists
      const pls = await this.storage.getPlaylists('google');
      if (pls && pls.length > 0) {
        this.googlePlaylists.set(pls);
        this.trans_google.set(true);
      } else {
        this.googlePlaylists.set([]);
        this.trans_google.set(false);
      }

      // Load Spotify playlists
      const spotifyPls = await this.storage.getPlaylists('spotify');
      if (spotifyPls && spotifyPls.length > 0) {
        this.spotifyPlaylists.set(spotifyPls);
        this.trans_spotify.set(true);
      } else {
        this.spotifyPlaylists.set([]);
        this.trans_spotify.set(false);
      }

      if ((pls && pls.length > 0) || (spotifyPls && spotifyPls.length > 0)) {
        this.toast.show('Loaded saved playlists', ErrorSeverity.INFO, 2500);
      } else {
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
          await this.storage.savePlaylists(mapped, 'google');
        }
        this.trans_google.set(true);
      }
    } catch (error) {
      console.error('Failed to connect to Google', error);
    } finally {
      this.connecting.set(false);
    }
  }

  async connectSpotify() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.connecting.set(true);
    try {
      // Check if we're handling an OAuth callback
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      const error = urlParams.get('error');

      if (error) {
        throw new Error(`Spotify authorization error: ${error}`);
      }

      if (code && state) {
        // Handle OAuth callback
        this.toast.show('Completing Spotify authorization…', ErrorSeverity.INFO, 5000);
        const success = await this.spotify.handleCallback(code, state);

        if (!success) {
          throw new Error('Failed to complete Spotify authorization');
        }

        // Clear URL parameters
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (!this.spotify.isAuthenticated()) {
        // Start OAuth flow
        this.toast.show('Redirecting to Spotify for authorization…', ErrorSeverity.INFO, 3000);
        await this.spotify.authenticate();
        return; // Will redirect, so return early
      }

      // At this point we should be authenticated, fetch playlists
      this.toast.show('Loading Spotify playlists…', ErrorSeverity.INFO, 10000);

      const spotifyPlaylists = await this.spotify.getUserPlaylists();
      const convertedPlaylists: PlaylistColumn[] = spotifyPlaylists.map(
        (playlist: SpotifyPlaylist) => ({
          id: playlist.id,
          title: playlist.name,
          description: playlist.description || '',
          color: '#1db954', // Spotify green
          videos: [], // Will be loaded when expanded
          publishedAt: Date.now(), // Spotify doesn't provide creation date via API
          lastUpdated: Date.now(),
        }),
      );

      this.spotifyPlaylists.set(convertedPlaylists);
      await this.storage.savePlaylists(convertedPlaylists, 'spotify');
      this.trans_spotify.set(true);

      this.toast.show(
        `Connected to Spotify! Loaded ${convertedPlaylists.length} playlists`,
        ErrorSeverity.INFO,
        4000,
      );
    } catch (error) {
      console.error('Failed to connect to Spotify:', error);
      this.toast.show(`Failed to connect to Spotify: ${error}`, ErrorSeverity.ERROR, 5000);
    } finally {
      this.connecting.set(false);
    }
  }

  /**
   * Load all Spotify playlists with their complete track data
   */
  async loadAllSpotifyData() {
    if (!isPlatformBrowser(this.platformId) || !this.spotify.isAuthenticated()) {
      this.toast.show('Please connect to Spotify first', ErrorSeverity.WARNING, 3000);
      return;
    }

    this.connecting.set(true);
    try {
      this.toast.show(
        'Loading all Spotify playlists and tracks... This may take a while.',
        ErrorSeverity.INFO,
        10000,
      );

      // Use the comprehensive method to get all data
      const spotifyPlaylistsWithTracks = await this.spotify.getAllPlaylistsWithTracks();

      // Convert to our internal format with complete track data
      const convertedPlaylists: PlaylistColumn[] = spotifyPlaylistsWithTracks.map(
        (playlist: SpotifyPlaylist) => {
          const convertedVideos =
            playlist.tracks.items?.map((track) => ({
              id: track.track.id,
              title: `${track.track.name} - ${track.track.artists.map((a) => a.name).join(', ')}`,
              description: `Album: ${track.track.album.name} | Artists: ${track.track.artists.map((a) => a.name).join(', ')}`,
              duration: this.formatDuration(track.track.duration_ms),
              thumbnail: track.track.album.images?.[0]?.url || '',
              tags: ['spotify', 'music', ...track.track.artists.map((a) => a.name.toLowerCase())],
              channelTitle: track.track.artists[0]?.name || 'Unknown Artist',
              publishedAt: '', // Spotify doesn't provide this
              youtubeUrl: track.track.external_urls.spotify,
              spotifyTrackId: track.track.id,
              spotifyAlbum: track.track.album.name,
              spotifyArtists: track.track.artists.map((a) => a.name),
              spotifyDurationMs: track.track.duration_ms,
            })) || [];

          return {
            id: playlist.id,
            title: playlist.name,
            description: `${playlist.description || ''} (${convertedVideos.length} tracks)`,
            color: '#1db954', // Spotify green
            videos: convertedVideos,
            publishedAt: Date.now(),
            lastUpdated: Date.now(),
            spotifyPlaylistId: playlist.id,
            spotifyOwner: playlist.owner.display_name || playlist.owner.id,
            spotifyTrackCount: playlist.tracks.total,
          };
        },
      );

      // Update UI and storage
      this.spotifyPlaylists.set(convertedPlaylists);
      await this.storage.savePlaylists(convertedPlaylists, 'spotify');
      this.trans_spotify.set(true);

      // Auto-expand all playlists since we already have the track data
      const expandedState: Record<string, boolean> = {};
      convertedPlaylists.forEach((playlist) => {
        expandedState[playlist.id] = true;
      });
      this.expandedPlaylists.set(expandedState);

      const totalTracks = convertedPlaylists.reduce(
        (sum, playlist) => sum + (playlist.videos?.length || 0),
        0,
      );
      this.toast.show(
        `✓ Loaded all Spotify data: ${convertedPlaylists.length} playlists with ${totalTracks} total tracks`,
        ErrorSeverity.INFO,
        5000,
      );
    } catch (error) {
      console.error('Failed to load all Spotify data:', error);
      this.toast.show(`Failed to load all Spotify data: ${error}`, ErrorSeverity.ERROR, 5000);
    } finally {
      this.connecting.set(false);
    }
  }

  /**
   * Migration helper: Copy playlists from legacy stores (playlists/videos) to Google stores
   */
  async migrateDatabase(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.connecting.set(true);
    try {
      this.toast.show('Migrating database…', ErrorSeverity.INFO, 60000);

      // Get legacy playlists from the old store
      const legacyPlaylists = await this.indexedDb.getAll<PlaylistColumn>('playlists');

      if (!legacyPlaylists || legacyPlaylists.length === 0) {
        this.toast.show('No legacy playlists found to migrate', ErrorSeverity.WARNING, 3000);
        return;
      }

      // Load videos for each playlist from the legacy video store
      for (const playlist of legacyPlaylists) {
        const videos = await this.indexedDb.getVideosByPlaylist(playlist.id);
        playlist.videos = videos.map((video: any) => {
          if (video.thumbnailBlob) {
            video.thumbnailUrl = URL.createObjectURL(video.thumbnailBlob);
          }
          return video;
        });
      }

      // Save to the new Google-specific stores
      await this.storage.savePlaylists(legacyPlaylists, 'google');

      // Update the UI
      this.googlePlaylists.set(legacyPlaylists);
      this.trans_google.set(true);

      this.toast.show(
        `Migrated ${legacyPlaylists.length} playlists to Google storage`,
        ErrorSeverity.INFO,
        4000,
      );
    } catch (error) {
      console.error('Failed to migrate database', error);
      this.toast.show('Database migration failed', ErrorSeverity.ERROR, 4000);
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

    // Check both Google and Spotify playlists to find the playlist
    let playlist: PlaylistColumn | undefined;
    let service: 'google' | 'spotify' | undefined;
    let playlistArray: PlaylistColumn[] = [];
    let setPlaylistArray: (playlists: PlaylistColumn[]) => void = () => {};
    let idx = -1;

    // First check Google playlists
    const googlePlaylists = [...this.googlePlaylists()];
    idx = googlePlaylists.findIndex((p) => p.id === playlistId);
    if (idx !== -1) {
      playlist = googlePlaylists[idx];
      service = 'google';
      playlistArray = googlePlaylists;
      setPlaylistArray = (playlists) => this.googlePlaylists.set(playlists);
    } else {
      // Then check Spotify playlists
      const spotifyPlaylists = [...this.spotifyPlaylists()];
      idx = spotifyPlaylists.findIndex((p) => p.id === playlistId);
      if (idx !== -1) {
        playlist = spotifyPlaylists[idx];
        service = 'spotify';
        playlistArray = spotifyPlaylists;
        setPlaylistArray = (playlists) => this.spotifyPlaylists.set(playlists);
      }
    }

    if (!playlist || !service) {
      console.warn('Playlist not found:', playlistId);
      return;
    }

    // If songs/videos already loaded, just expand
    if (playlist.videos && playlist.videos.length > 0) {
      currExpanded[playlistId] = true;
      this.expandedPlaylists.set(currExpanded);
      return;
    }

    // Set per-playlist loading state
    this.loadingVideos.update((m) => ({ ...(m || {}), [playlistId]: true }));
    const itemType = service === 'spotify' ? 'songs' : 'videos';
    this.toast.show(`Loading ${itemType}…`, ErrorSeverity.INFO, 60000);

    try {
      if (service === 'spotify') {
        // For Spotify, fetch tracks via Spotify API
        const tracks = await this.spotify.getPlaylistTracks(playlistId);
        const convertedVideos = tracks.map((track, index) => ({
          id: track.track.id,
          title: `${track.track.name} - ${track.track.artists.map((a) => a.name).join(', ')}`,
          description: `Album: ${track.track.album.name}`,
          duration: this.formatDuration(track.track.duration_ms),
          thumbnail: track.track.album.images?.[0]?.url || '',
          tags: ['spotify', 'music'],
          channelTitle: track.track.artists[0]?.name || 'Unknown Artist',
          publishedAt: '', // Spotify doesn't provide this
          youtubeUrl: track.track.external_urls.spotify,
          spotifyTrack: track.track, // Store original Spotify data
        }));

        // Update the playlist with fetched tracks
        playlist.videos = convertedVideos;
        playlistArray[idx] = playlist;
        setPlaylistArray(playlistArray);

        // Persist updated playlists to storage
        await this.storage.savePlaylists(playlistArray, service);

        // Mark expanded so UI shows track list
        currExpanded[playlistId] = true;
        this.expandedPlaylists.set(currExpanded);
        this.toast.show(`Loaded ${convertedVideos.length} tracks`, ErrorSeverity.INFO, 2000);
      } else {
        // For Google, fetch videos via YouTube API
        const updated = await this.playlistSvc.fetchAllPlaylistItems([playlist]);
        if (updated && updated.length > 0) {
          playlistArray[idx] = updated[0];
          setPlaylistArray(playlistArray);
          // Persist playlists (now with videos) to storage
          await this.storage.savePlaylists(playlistArray, service);
          // Mark expanded so UI shows numeric list
          currExpanded[playlistId] = true;
          this.expandedPlaylists.set(currExpanded);
          this.toast.show('Videos loaded', ErrorSeverity.INFO, 2000);
        } else {
          this.toast.show('No videos found for playlist', ErrorSeverity.WARNING, 2500);
        }
      }
    } catch (err) {
      console.error(`Failed to load ${itemType} for playlist`, playlistId, err);
      this.toast.show(`Failed to load ${itemType}`, ErrorSeverity.ERROR, 4000);
    } finally {
      this.loadingVideos.update((m) => ({ ...(m || {}), [playlistId]: false }));
    }
  }

  /**
   * Format duration from milliseconds to MM:SS format
   */
  private formatDuration(durationMs: number): string {
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
