import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import {  CdkDragDrop,  DragDropModule,  moveItemInArray, CdkDragHandle,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { YoutubeApiService } from '../services/youtube-api.service';
import { YouTubeSearchResult } from '../services/youtube-api.types';
import { SpotifyApiService, SpotifyPlaylist } from '../services/spotify-api.service';
import { StorageService } from '../services/StorageService';
import { RouterModule } from '@angular/router';
import { IndexedDbService } from '../services/indexed-db.service';
import { PlaylistColumn, VideoCard } from '../services/playlist.service';
import { PlaylistService } from '../services/playlist.service';
import { ThemeService } from '../services/theme.service';
import { ToastService } from '../services/toast.service';
import { ErrorHandlerService, ErrorSeverity } from '../services/ErrorHandlerService';
import { PlayerManagerService } from '../services/PlayerManagerService';

@Component({
  selector: 'app-transfer',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, CdkDragHandle, RouterModule],
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
  private errorHandler = inject(ErrorHandlerService);
  private playerManager = inject(PlayerManagerService);
  private platformId = inject(PLATFORM_ID);

  connecting = signal(false);
  trans_google = signal(false);
  trans_spotify = signal(false);
  google_authenticated = signal(false);
  spotify_authenticated = signal(false);

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
      // Only attempt to load browser-only scripts when running in the browser
      if (!isPlatformBrowser(this.platformId)) {
        return;
      }

      this.toast.show('Loading saved playlists from google…', ErrorSeverity.INFO, 60000);
      const pls = await this.storage.getGooglePlaylists();
      if (pls && pls.length > 0) {
        this.googlePlaylists.set(pls);
        this.trans_google.set(true);
      }

      //If no playlists found in storage, try to silently load from IndexedDB
      this.toast.show('Loading saved playlists from spotify…', ErrorSeverity.INFO, 60000);
      const spotifyPls = await this.storage.getSpotifyPlaylists();
      if (spotifyPls && spotifyPls.length > 0) {
        this.spotifyPlaylists.set(spotifyPls);
        this.trans_spotify.set(true);
      } else if (this.spotify.isAuthenticated()) {
        this.spotify_authenticated.set(true);

        // If Spotify is authenticated but no playlists cached, try to load them
        try {
          this.toast.show('Loading Spotify playlists…', ErrorSeverity.INFO, 10000);
          await this.connectSpotify();
        } catch (error) {
          console.error('Failed to auto-load Spotify playlists:', error);
        }
      }



      try {

        // If nothing persisted but user already authenticated (e.g., came from Organizer)
        if ((!pls || pls.length === 0)) {

          // show loading toast while silently fetching (dismissed with success/failure)
          this.toast.show('Checking for playlists from google…', ErrorSeverity.INFO, 60000);
          await this.youtube.load();
          if (this.youtube.isAuthenticated()) {
            this.google_authenticated.set(true);
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
        }

        if (!spotifyPls || spotifyPls.length === 0) {

          if (this.spotify.isAuthenticated()) {
            this.spotify_authenticated.set(true);
            this.toast.show('Loading saved playlists from spotify…', ErrorSeverity.INFO, 60000);
            const spotifyPls = await this.storage.getSpotifyPlaylists();
            if (spotifyPls && spotifyPls.length > 0) {
              this.spotifyPlaylists.set(spotifyPls);
              this.trans_spotify.set(true);
              this.toast.show('Playlists restored from your account', ErrorSeverity.INFO, 3000);
            }
          }
        }

      } catch (e) {
        const appErr = this.errorHandler.handleYouTubeError(e, 'ngOnInit.silentFetch');
        this.toast.show(appErr.message, appErr.severity);
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
      const appErr = this.errorHandler.handleError(err, 'loadSavedPlaylists');
      this.toast.show(appErr.message, appErr.severity);
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
        this.google_authenticated.set(true);
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
      const appErr = this.errorHandler.handleYouTubeError(error, 'connectGoogle');
      this.toast.show(appErr.message, appErr.severity);
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
      const appErr = this.errorHandler.handleError(error, 'connectSpotify');
      this.toast.show(appErr.message, appErr.severity);
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
      const appErr = this.errorHandler.handleError(error, 'loadAllSpotifyData');
      this.toast.show(appErr.message, appErr.severity);
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
    let setPlaylistArray: (playlists: PlaylistColumn[]) => void = () => { };
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
        if (!this.youtube.isAuthenticated()) {
          this.toast.show('Please connect to Google first.', ErrorSeverity.WARNING, 3000);
          return;
        }

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

          // After loading videos for a playlist, check if we can calculate matches
          const playlistJustLoaded = service === 'google' ?
            this.googlePlaylists().find(p => p.id === playlistId) :
            this.spotifyPlaylists().find(p => p.id === playlistId);

          if (playlistJustLoaded) {
            let googlePlaylist: PlaylistColumn | undefined;
            let spotifyPlaylist: PlaylistColumn | undefined;

            if (service === 'google') {
              googlePlaylist = playlistJustLoaded;
              spotifyPlaylist = this.spotifyPlaylists().find(p => p.title.toLowerCase() === googlePlaylist!.title.toLowerCase());
            } else { // service === 'spotify'
              spotifyPlaylist = playlistJustLoaded;
              googlePlaylist = this.googlePlaylists().find(p => p.title.toLowerCase() === spotifyPlaylist!.title.toLowerCase());
            }

            if (googlePlaylist && spotifyPlaylist && googlePlaylist.videos?.length > 0 && spotifyPlaylist.videos?.length > 0) {
              this.calculateMatches(googlePlaylist, spotifyPlaylist);
              await this.storage.savePlaylists(this.googlePlaylists(), 'google');
              await this.storage.savePlaylists(this.spotifyPlaylists(), 'spotify');
            }
          }
        } else {
          this.toast.show('No videos found for playlist', ErrorSeverity.WARNING, 2500);
        }
      }
    } catch (err) {
      const appErr = this.errorHandler.handleError(err, `loadVideosForPlaylist:${service}`);
      this.toast.show(appErr.message, appErr.severity);
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

  async performTransfer() {
    this.connecting.set(true);
    this.toast.show('Starting playlist transfer from Spotify to YouTube...', ErrorSeverity.INFO, 10000);

    try {
      // 1. Get all Spotify playlists from component state
      const spotifyPlaylists = this.spotifyPlaylists();
      if (!spotifyPlaylists || spotifyPlaylists.length === 0) {
        this.toast.show('No Spotify playlists loaded to transfer.', ErrorSeverity.WARNING, 3000);
        return;
      }

      // 2. Get all existing YouTube playlists from component state
      const googlePlaylists = this.googlePlaylists();
      const existingYoutubePlaylistTitles = new Set(
        googlePlaylists.map((p) => p.title.toLowerCase())
      );

      this.toast.show(`Found ${spotifyPlaylists.length} Spotify playlists. Checking against existing YouTube playlists...`, ErrorSeverity.INFO, 5000);

      let createdCount = 0;
      let skippedCount = 0;

      // 3. Iterate over Spotify playlists and create them on YouTube
      for (const spotifyPlaylist of spotifyPlaylists) {
        const playlistName = spotifyPlaylist.title;
        const playlistDescription = spotifyPlaylist.description || '';

        // 4. Check if a playlist with the same name already exists (case-insensitive)
        if (existingYoutubePlaylistTitles.has(playlistName.toLowerCase())) {
          console.log(`Playlist "${playlistName}" already exists on YouTube. Skipping.`);
          skippedCount++;
          continue;
        }

        try {
          // 5. Create the playlist on YouTube
          await this.youtube.createPlaylist(playlistName, playlistDescription);
          createdCount++;
          this.toast.show(`Created playlist: "${playlistName}"`, ErrorSeverity.INFO, 2000);
        } catch (error) {
          const appErr = this.errorHandler.handleYouTubeError(error, 'performTransfer.create');
          this.toast.show(`Error for "${playlistName}": ${appErr.message}`, appErr.severity);
        }
      }

      this.toast.show(
        `Transfer complete! Created: ${createdCount}, Skipped: ${skippedCount}`,
        ErrorSeverity.INFO,
        5000
      );

      // Refresh the list of Google playlists in the UI after transfer
      await this.connectGoogle();

    } catch (error) {
      const appErr = this.errorHandler.handleError(error, 'performTransfer');
      this.toast.show(appErr.message, appErr.severity);
    } finally {
      this.connecting.set(false);
    }
  }

  /**
   * Transfers all songs from all loaded Spotify playlists to matching YouTube playlists.
   */
  async transferSongsToYouTubePlaylists() {
    this.connecting.set(true);
    this.toast.show('Starting song transfer...', ErrorSeverity.INFO, 10000);

    try {
      const googlePlaylists = this.googlePlaylists();

      // Ensure all spotify tracks are loaded before starting the bulk transfer
      if (this.spotifyPlaylists().some((p) => !p.videos || p.videos.length === 0)) {
        await this.loadAllSpotifyData();
      }
      const spotifyPlaylists = this.spotifyPlaylists(); // Get the fresh list with all tracks

      if (!spotifyPlaylists.length) {
        this.toast.show('No Spotify playlists loaded.', ErrorSeverity.WARNING, 3000);
        return;
      }
      if (!googlePlaylists.length) {
        this.toast.show('No YouTube playlists loaded.', ErrorSeverity.WARNING, 3000);
        return;
      }

      const youtubePlaylistsMap = new Map(googlePlaylists.map((p) => [p.title.toLowerCase(), p]));

      for (const spotifyPlaylist of spotifyPlaylists) {
        await this._transferSongsForPlaylist(spotifyPlaylist, youtubePlaylistsMap);
      }

      this.toast.show('Song transfer complete!', ErrorSeverity.INFO, 5000);
    } catch (error) {
      const appErr = this.errorHandler.handleError(error, 'transferSongsToYouTubePlaylists');
      this.toast.show(appErr.message, appErr.severity);
    } finally {
      this.connecting.set(false);
    }
  }

  /**
   * Transfers songs from a single Spotify playlist to its matching YouTube playlist.
   * @param spotifyPlaylist The specific Spotify playlist to transfer songs from.
   */
  async transferSinglePlaylistSongs(spotifyPlaylist: PlaylistColumn) {
    this.connecting.set(true);
    this.toast.show(`Transferring songs from "${spotifyPlaylist.title}"...`, ErrorSeverity.INFO, 10000);

    try {
      const googlePlaylists = this.googlePlaylists();
      if (!googlePlaylists.length) {
        this.toast.show('No YouTube playlists loaded.', ErrorSeverity.WARNING, 3000);
        return;
      }

      const youtubePlaylistsMap = new Map(googlePlaylists.map((p) => [p.title.toLowerCase(), p]));

      await this._transferSongsForPlaylist(spotifyPlaylist, youtubePlaylistsMap);

      this.toast.show(`Finished transferring songs for "${spotifyPlaylist.title}"!`, ErrorSeverity.INFO, 5000);
    } catch (error) {
      const appErr = this.errorHandler.handleError(error, `transferSinglePlaylistSongs:${spotifyPlaylist.title}`);
      this.toast.show(appErr.message, appErr.severity);
    } finally {
      this.connecting.set(false);
    }
  }

  /**
   * Private helper to handle the logic of transferring songs for a single playlist.
   * @param spotifyPlaylist The source Spotify playlist.
   * @param youtubePlaylistsMap A map of lowercase YouTube playlist titles to playlist objects.
   */
  private async _transferSongsForPlaylist(
    spotifyPlaylist: PlaylistColumn,
    youtubePlaylistsMap: Map<string, PlaylistColumn>,
  ) {
    try {

      const targetPlaylist = youtubePlaylistsMap.get(spotifyPlaylist.title.toLowerCase());

      if (!targetPlaylist) {
        this.toast.show(`YouTube playlist "${spotifyPlaylist.title}" not found. Skipping.`, ErrorSeverity.WARNING, 3000);
        return;
      }

      // Ensure spotify tracks are loaded for this playlist if they aren't already
      let playlistToProcess = spotifyPlaylist;
      if (!playlistToProcess.videos || playlistToProcess.videos.length === 0) {
        await this.loadVideosForPlaylist(playlistToProcess.id);
        const updatedPlaylist = this.spotifyPlaylists().find((p) => p.id === playlistToProcess.id);
        if (!updatedPlaylist?.videos?.length) {
          this.toast.show(`Could not load songs for "${playlistToProcess.title}".`, ErrorSeverity.ERROR, 3000);
          return;
        }
        playlistToProcess = updatedPlaylist;
      }

      this.toast.show(`Processing songs for "${targetPlaylist.title}"...`, ErrorSeverity.INFO, 5000);

      const [youtubePlaylistWithVideos] = await this.playlistSvc.fetchAllPlaylistItems([targetPlaylist]);
      const existingVideoTitles = new Set(youtubePlaylistWithVideos.videos.map((v) => v.title.toLowerCase()));

      for (const spotifyTrack of playlistToProcess.videos) {
        const searchQuery = spotifyTrack.title;

        // Basic fuzzy check to see if a song with a similar title already exists
        const songTitle = searchQuery.split('-')[0].trim().toLowerCase();
        let exists = false;
        for (const existingTitle of existingVideoTitles) {
          if (existingTitle.includes(songTitle)) {
            exists = true;
            break;
          }
        }

        if (exists) {
          console.log(`Song "${searchQuery}" seems to already exist in "${targetPlaylist.title}". Skipping.`);
          continue;
        }

        try {
          const searchResults = await this.youtube.searchMusicVideos(searchQuery, 1);
          if (searchResults?.items?.length > 0) {
            const videoId = searchResults.items[0].id.videoId;
            await this.youtube.addVideoToPlaylist(targetPlaylist.id, videoId);
            this.toast.show(`Added "${searchQuery}" to "${targetPlaylist.title}"`, ErrorSeverity.INFO, 2000);
            existingVideoTitles.add(searchQuery.toLowerCase()); // Avoid re-adding in the same run
          } else {
            this.toast.show(`No YouTube video found for "${searchQuery}"`, ErrorSeverity.WARNING, 2000);
          }
        } catch (error) {
          const appErr = this.errorHandler.handleYouTubeError(error, '_transferSongsForPlaylist.searchAdd');
          this.toast.show(`Error for "${searchQuery}": ${appErr.message}`, appErr.severity);
        }
      }
    } catch (error) {
      // This top-level catch handles errors in the setup (e.g., fetching playlist items)
      const appErr = this.errorHandler.handleError(error, '_transferSongsForPlaylist');
      this.toast.show(appErr.message, appErr.severity);
    }
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

  getYouTubePlaylistUrl(playlistId: string): string {
    return `https://www.youtube.com/playlist?list=${playlistId}`;
  }

  calculateMatches(googlePlaylist: PlaylistColumn, spotifyPlaylist: PlaylistColumn) {
    const googleVideoTitles = new Set(googlePlaylist.videos.map(v => v.title.toLowerCase()));
    const spotifyTrackTitles = new Set(spotifyPlaylist.videos.map(v => v.title.toLowerCase()));

    const isMatched = (title: string, otherTitles: Set<string>) => {
      let exists = false;
      const lowerTitle = title.toLowerCase();
      for (const otherTitle of otherTitles) {
        if (otherTitle.includes(lowerTitle.split('-')[0].trim()) || lowerTitle.includes(otherTitle.split('-')[0].trim())) {
          exists = true;
          break;
        }
      }
      return exists;
    };

    googlePlaylist.videos.forEach(video => {
      video.matched = isMatched(video.title, spotifyTrackTitles);
    });

    spotifyPlaylist.videos.forEach(video => {
      video.matched = isMatched(video.title, googleVideoTitles);
    });

    this.googlePlaylists.update(playlists => {
      const index = playlists.findIndex(p => p.id === googlePlaylist.id);
      if (index !== -1) playlists[index] = googlePlaylist;
      return [...playlists];
    });
    this.spotifyPlaylists.update(playlists => {
      const index = playlists.findIndex(p => p.id === spotifyPlaylist.id);
      if (index !== -1) playlists[index] = spotifyPlaylist;
      return [...playlists];
    });
  }

  /**
   * Handles dropping a song into a playlist.
   * Supports cross-platform (Spotify to YouTube) transfers.
   */
  async dropSong(event: CdkDragDrop<VideoCard[]>) {
    // If dropped in the same list, it's a reorder. We can ignore this for now.
    if (event.previousContainer === event.container) {
      // To enable reordering, you would use moveItemInArray here.
      return;
    }

    const sourcePlaylistId = event.previousContainer.id;
    const destPlaylistId = event.container.id;
    const songToTransfer = event.previousContainer.data[event.previousIndex];

    // Check if this is a Spotify -> YouTube transfer
    const sourceIsSpotify = this.spotifyPlaylists().some((p) => p.id === sourcePlaylistId);
    const destIsYouTube = this.googlePlaylists().some((p) => p.id === destPlaylistId);

    if (!sourceIsSpotify || !destIsYouTube) {
      this.toast.show(
        'Drag and drop is only supported from Spotify to YouTube playlists.',
        ErrorSeverity.WARNING,
        4000,
      );
      return;
    }

    // Prevent dropping if the song is already matched/transferred
    if (songToTransfer.matched) {
      this.toast.show(
        `"${songToTransfer.title}" has already been transferred.`,
        ErrorSeverity.INFO,
        3000,
      );
      return;
    }

    this.connecting.set(true);
    this.toast.show(`Transferring "${songToTransfer.title}"...`, ErrorSeverity.INFO, 60000);

    try {
      const targetYouTubePlaylist = this.googlePlaylists().find((p) => p.id === destPlaylistId);
      if (!targetYouTubePlaylist) {
        throw new Error('Target YouTube playlist not found.');
      }

      // 1. Search for the song on YouTube
      const searchQuery = songToTransfer.title;
      const searchResults = await this.youtube.searchMusicVideos(searchQuery, 1);

      if (!searchResults?.items?.length) {
        this.toast.show(`No YouTube video found for "${searchQuery}"`, ErrorSeverity.WARNING, 3000);
        return;
      }

      const videoId = searchResults.items[0].id.videoId;

      // 2. Add the found video to the YouTube playlist
      await this.youtube.addVideoToPlaylist(destPlaylistId, videoId);

      // 3. Update the UI: add the new video to the YouTube playlist's video list
      const newVideo: VideoCard = {
        id: videoId,
        title: searchResults.items[0].snippet.title || 'Unknown Title',
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: searchResults.items[0].snippet.thumbnails?.default?.url,
        matched: true,
        description: ''
      };

      this.googlePlaylists.update((playlists) => {
        const playlist = playlists.find((p) => p.id === destPlaylistId);
        if (playlist) {
          playlist.videos = [...(playlist.videos || []), newVideo];
        }
        return [...playlists];
      });

      // 4. Mark the source Spotify song as matched
      this.spotifyPlaylists.update((playlists) => {
        const playlist = playlists.find((p) => p.id === sourcePlaylistId);
        const song = playlist?.videos.find((v) => v.id === songToTransfer.id);
        if (song) {
          song.matched = true;
        }
        return [...playlists];
      });

      // 5. Persist changes
      await this.storage.savePlaylists(this.googlePlaylists(), 'google');
      await this.storage.savePlaylists(this.spotifyPlaylists(), 'spotify');

      this.toast.show(`Added "${searchQuery}" to "${targetYouTubePlaylist.title}"`, ErrorSeverity.INFO, 3000);
    } catch (error) {
      const appErr = this.errorHandler.handleYouTubeError(error, 'dropSong');
      this.toast.show(appErr.message, appErr.severity);
    } finally {
      this.connecting.set(false);
    }
  }

  async transferSong(songToTransfer: VideoCard, sourcePlaylist: PlaylistColumn) {
    // Prevent transferring if the song is already matched
    if (songToTransfer.matched) {
      this.toast.show(
        `"${songToTransfer.title}" has already been transferred.`,
        ErrorSeverity.INFO,
        3000,
      );
      return;
    }

    this.connecting.set(true);
    this.toast.show(`Transferring "${songToTransfer.title}"...`, ErrorSeverity.INFO, 60000);

    try {
      // 1. Find or create the destination YouTube playlist
      let targetYouTubePlaylist = this.googlePlaylists().find(
        (p) => p.title.toLowerCase() === sourcePlaylist.title.toLowerCase()
      );

      if (!targetYouTubePlaylist) {
        this.toast.show(`Creating YouTube playlist "${sourcePlaylist.title}"...`, ErrorSeverity.INFO, 5000);
        const newPlaylist = await this.youtube.createPlaylist(sourcePlaylist.title, sourcePlaylist.description || '');

        const newPlaylistColumn: PlaylistColumn = {
          id: newPlaylist.id,
          title: newPlaylist.snippet?.title || '',
          description: newPlaylist.snippet?.description || '',
          color: '#e0e0e0',
          videos: [],
          publishedAt: newPlaylist.snippet?.publishedAt ? new Date(newPlaylist.snippet.publishedAt).getTime() : 0,
          lastUpdated: Date.now(),
        };

        this.googlePlaylists.update(playlists => [...playlists, newPlaylistColumn]);
        await this.storage.savePlaylists(this.googlePlaylists(), 'google');
        targetYouTubePlaylist = newPlaylistColumn;
      }

      if (!targetYouTubePlaylist) {
        throw new Error('Could not find or create the target YouTube playlist.');
      }

      const destPlaylistId = targetYouTubePlaylist.id;

      // 2. Search for the song on YouTube
      const searchQuery = songToTransfer.title;
      const searchResults = await this.youtube.searchMusicVideos(searchQuery, 1);

      if (!searchResults?.items?.length) {
        this.toast.show(`No YouTube video found for "${searchQuery}"`, ErrorSeverity.WARNING, 3000);
        this.connecting.set(false); // Make sure to stop spinner on early exit
        return;
      }

      const videoId = searchResults.items[0].id.videoId;
      const videoTitle = searchResults.items[0].snippet.title || 'Unknown Title';

      // 3. Add the found video to the YouTube playlist
      await this.youtube.addVideoToPlaylist(destPlaylistId, videoId);

      // 4. Update the UI: add the new video to the YouTube playlist's video list
      const newVideo: VideoCard = {
        id: videoId,
        title: videoTitle,
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: searchResults.items[0].snippet.thumbnails?.default?.url,
        matched: true,
        description: ''
      };

      this.googlePlaylists.update((playlists) => {
        const playlist = playlists.find((p) => p.id === destPlaylistId);
        if (playlist) {
          // Ensure videos array exists
          if (!playlist.videos) {
            playlist.videos = [];
          }
          playlist.videos.push(newVideo);
        }
        return [...playlists];
      });

      // 5. Mark the source Spotify song as matched
      this.spotifyPlaylists.update((playlists) => {
        const playlist = playlists.find((p) => p.id === sourcePlaylist.id);
        const song = playlist?.videos.find((v) => v.id === songToTransfer.id);
        if (song) {
          song.matched = true;
        }
        return [...playlists];
      });

      // 6. Persist changes
      await this.storage.savePlaylists(this.googlePlaylists(), 'google');
      await this.storage.savePlaylists(this.spotifyPlaylists(), 'spotify');

      this.toast.show(`Added "${searchQuery}" to "${targetYouTubePlaylist.title}"`, ErrorSeverity.INFO, 3000);
    } catch (error) {
      const appErr = this.errorHandler.handleYouTubeError(error, 'transferSong');
      this.toast.show(appErr.message, appErr.severity);
    } finally {
      this.connecting.set(false);
    }
  }

  /**
   * Opens the song/video in a new tab from its source.
   * @param video The video/track card to preview.
   */
  previewSong(video: VideoCard): void {
    this.playerManager.open(video);
  }

}
