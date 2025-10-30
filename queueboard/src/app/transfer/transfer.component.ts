import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { YoutubeApiService } from '../shared/services/youtube-api.service';
import { YouTubePlaylist, YouTubeSearchResult } from '../shared/services/youtube-api.types';
import { StorageService, StorageKey } from '../services/StorageService';

@Component({
  selector: 'app-transfer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transfer.component.html',
  styleUrls: ['./transfer.component.scss']
})
export class TransferComponent implements OnInit {
  private youtube = inject(YoutubeApiService);
  private storage = inject(StorageService);

  connecting = signal(false);
  trans_google = signal(false);
  trans_spotify = signal(false); // Added for future use

  googlePlaylists = signal<YouTubePlaylist[]>([]);
  searchQuery = signal('');
  searchResults = signal<YouTubeSearchResult[]>([]);
  playlistSearchQuery = signal('');

  filteredGooglePlaylists = computed(() => {
    const query = this.playlistSearchQuery().toLowerCase();
    if (!query) {
      return this.googlePlaylists();
    }
    return this.googlePlaylists().filter(p => p.snippet?.title?.toLowerCase().includes(query));
  });

  ngOnInit(): void {
    const storedPlaylists = this.storage.getItem<YouTubePlaylist[]>(StorageKey.TRANSFER_GOOGLE);
    if (storedPlaylists) {
      this.googlePlaylists.set(storedPlaylists);
      this.trans_google.set(true);
    }
  }

  async connectGoogle() {
    this.connecting.set(true);
    try {
      await this.youtube.load();
      const token = await this.youtube.requestAccessToken();
      if (token) {
        const playlists = await this.youtube.fetchPlaylists();
        this.googlePlaylists.set(playlists.items);
        if(playlists.items.length > 0)
          this.storage.setItem(StorageKey.TRANSFER_GOOGLE, playlists.items);
        this.trans_google.set(true);
      }
    } catch (error) {
      console.error('Failed to connect to Google', error);
    } finally {
      this.connecting.set(false);
    }
  }

  async search() {
    if (!this.searchQuery()) {
      return;
    }
    const results = await this.youtube.searchMusicVideos(this.searchQuery());
    this.searchResults.set(results.items);
  }
}
