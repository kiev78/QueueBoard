import { Injectable, OnDestroy } from '@angular/core';
import { signal } from '@angular/core';
import { VideoCard } from './playlist.service';

/**
 * Service to manage YouTube player instances and prevent memory leaks.
 * Handles creation, tracking, and cleanup of player instances.
 */
@Injectable({
  providedIn: 'root',
})
export class PlayerManagerService implements OnDestroy {
  /**
   * Toggle play/pause state for a given video/player id.
   * Gracefully no-ops if player not found.
   */
  togglePlayPause(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    let state: YT.PlayerState;
    try {
      state = player.getPlayerState();
    } catch {
      return;
    }
    if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
      try {
        player.pauseVideo();
      } catch {}
    } else {
      try {
        player.playVideo();
      } catch {}
    }
    // Update signal with new state
    try {
      this.playerState.set(player.getPlayerState());
    } catch {}
  }
  private players = new Map<string, YT.Player>();
  private readonly MAX_PLAYERS = 10; // Prevent unbounded growth

  readonly selectedVideo = signal<VideoCard | null>(null);
  readonly minimizedVideos = signal<VideoCard[]>([]);
  readonly playerState = signal<YT.PlayerState | null>(null);
  readonly playerReady = signal(false);

  /**
   * Registers a player instance
   */
  registerPlayer(videoId: string, player: YT.Player): void {
    // Enforce MAX_PLAYERS: drop the oldest (FIFO) if exceeding cap
    if (this.players.size >= this.MAX_PLAYERS) {
      const firstKey = this.players.keys().next().value as string | undefined;
      if (firstKey) {
        const old = this.players.get(firstKey);
        try {
          old?.destroy?.();
        } catch {}
        this.players.delete(firstKey);
      }
    }
    this.players.set(videoId, player);
    const sel = this.selectedVideo();
    const minimized = this.minimizedVideos().find((v) => v.id === videoId);
    const resumeTime = sel?.id === videoId ? sel.resumeTime : minimized?.resumeTime;
    if (resumeTime && resumeTime > 0) {
      try {
        player.seekTo(Math.floor(resumeTime), true);
      } catch {}
    }
    try {
      player.playVideo();
    } catch {}
    this.playerReady.set(true);
  }

  /**
   * Gets a registered player instance
   */
  getPlayer(videoId: string): YT.Player | undefined {
    return this.players.get(videoId);
  }

  /**
   * Destroys and unregisters a player instance
   */
  destroyPlayer(videoId: string): void {
    const player = this.players.get(videoId);
    if (player) {
      try {
        player.destroy();
      } catch (error) {
        console.warn(`Failed to destroy player for video ${videoId}:`, error);
      }
      this.players.delete(videoId);
    }
  }

  /**
   * Destroys all registered players
   */
  destroyAll(): void {
    for (const videoId of this.players.keys()) {
      this.destroyPlayer(videoId);
    }
  }

  /**
   * Gets the count of active players
   */
  getActivePlayerCount(): number {
    return this.players.size;
  }

  /**
   * Checks if a player exists
   */
  hasPlayer(videoId: string): boolean {
    return this.players.has(videoId);
  }

  open(video: VideoCard): void {
    const current = this.selectedVideo();
    if (current && current.id !== video.id) {
      this.close(current.id);
    }
    // Remove if in minimized list
    this.minimizedVideos.update((vs) => vs.filter((v) => v.id !== video.id));
    this.selectedVideo.set({ ...video, isMinimized: false });
    this.playerReady.set(false);
  }

  minimize(): void {
    const curr = this.selectedVideo();
    if (!curr) return;
    const player = this.players.get(curr.id);
    const resumeTime = player?.getCurrentTime?.() ?? 0;
    if (player) {
      try {
        player.destroy();
      } catch {}
      this.players.delete(curr.id);
    }
    const minVid = { ...curr, isMinimized: true, resumeTime };
    this.minimizedVideos.update((vs) => (vs.some((v) => v.id === curr.id) ? vs : [...vs, minVid]));
    this.selectedVideo.set(null);
    this.playerReady.set(false);
    this.playerState.set(null);
  }

  restore(videoId: string): void {
    const min = this.minimizedVideos().find((v) => v.id === videoId);
    if (!min) return;
    const current = this.selectedVideo();
    if (current && current.id !== videoId) {
      this.close(current.id);
    }
    // Remove from minimized
    this.minimizedVideos.update((vs) => vs.filter((v) => v.id !== videoId));
    this.selectedVideo.set({ ...min, isMinimized: false });
    this.playerReady.set(false);
  }

  close(videoId?: string): void {
    const vid = videoId || this.selectedVideo()?.id;
    if (!vid) return;
    if (this.selectedVideo()?.id === vid) {
      this.destroyPlayer(vid);
      this.selectedVideo.set(null);
    }
    this.minimizedVideos.update((vs) => vs.filter((v) => v.id !== vid));
    this.playerReady.set(false);
    this.playerState.set(null);
  }

  /**
   * Explicit setter for player state from external events.
   */
  setPlayerState(state: YT.PlayerState): void {
    this.playerState.set(state);
  }

  ngOnDestroy(): void {
    this.destroyAll();
  }
}
