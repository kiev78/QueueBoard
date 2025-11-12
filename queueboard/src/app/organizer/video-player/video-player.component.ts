import { Component, Input, Output, EventEmitter, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { YouTubePlayerModule } from '@angular/youtube-player';
import { VideoCard } from '../../services/playlist.service';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule, YouTubePlayerModule],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.scss']
})
export class VideoPlayerComponent {
  @Input({ required: true }) video!: VideoCard;

  @Output() closePlayer = new EventEmitter<void>();
  @Output() minimizePlayer = new EventEmitter<void>();
  @Output() playerReady = new EventEmitter<YT.PlayerEvent>();
  @Output() stateChange = new EventEmitter<YT.PlayerEvent>();

  currentPlaybackRate = signal(1);
  playerState = signal<YT.PlayerState | null>(null);
  private playerInstance?: YT.Player;

  @HostListener('window:keydown.space', ['$event'])
  onSpacebarPress(event: Event) {
    event.preventDefault(); // Prevent scrolling
    this.togglePlayPause();
  }

  @HostListener('window:keydown.arrowleft', ['$event'])
  onArrowLeftPress(event: Event) {
    event.preventDefault();
    this.seekVideo(-15); // Seek backward 15 seconds
  }

  @HostListener('window:keydown.arrowright', ['$event'])
  onArrowRightPress(event: Event) {
    event.preventDefault();
    this.seekVideo(15); // Seek forward 15 seconds
  }

  @HostListener('window:keydown.escape', ['$event'])
  onEscapePress(event: Event) {
    event.preventDefault();
    this.closePlayer.emit();
  }

  onPlayerReady(event: YT.PlayerEvent) {
    this.playerInstance = event.target;
    this.playerReady.emit(event);
  }

  onStateChange(event: YT.PlayerEvent) {
    this.playerState.set(event.data);
    this.stateChange.emit(event);
  }

  togglePlayPause() {
    if (!this.playerInstance) return;

    const state = this.playerInstance.getPlayerState();
    if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
      this.playerInstance.pauseVideo();
    } else {
      this.playerInstance.playVideo();
    }
  }

  seekVideo(seconds: number) {
    if (!this.playerInstance) return;
    const currentTime = this.playerInstance.getCurrentTime();
    this.playerInstance.seekTo(currentTime + seconds, true);
  }

  setPlaybackRate(speed: number) {
    this.currentPlaybackRate.set(speed);
    if (this.playerInstance) {
      this.playerInstance.setPlaybackRate(speed);
    }
  }
}