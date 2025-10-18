import { Injectable, OnDestroy } from '@angular/core';

/**
 * Service to manage YouTube player instances and prevent memory leaks.
 * Handles creation, tracking, and cleanup of player instances.
 */
@Injectable({
  providedIn: 'root'
})
export class PlayerManagerService implements OnDestroy {
  private players = new Map<string, YT.Player>();
  private readonly MAX_PLAYERS = 10; // Prevent unbounded growth

  /**
   * Registers a player instance
   */
  registerPlayer(videoId: string, player: YT.Player): void {
    // If player already exists, destroy it to prevent leaks before creating a new one.
    if (this.players.has(videoId)) {
      this.destroyPlayer(videoId);
    } else if (this.players.size >= this.MAX_PLAYERS) {
      // If adding a new player would exceed the max, remove the oldest one.
      const oldestKey = this.players.keys().next().value;
      if (oldestKey) {
        this.destroyPlayer(oldestKey);
      }
    }

    this.players.set(videoId, player);
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

  ngOnDestroy(): void {
    this.destroyAll();
  }
}