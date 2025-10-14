import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { YouTubePlayerModule } from '@angular/youtube-player';
import { VideoCard } from '../organizer.component';

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
  private playerInstance?: YT.Player;

  onPlayerReady(event: YT.PlayerEvent) {
    this.playerInstance = event.target;
    this.playerReady.emit(event);
  }

  onStateChange(event: YT.PlayerEvent) {
    this.stateChange.emit(event);
  }

  setPlaybackRate(speed: number) {
    this.currentPlaybackRate.set(speed);
    if (this.playerInstance) {
      this.playerInstance.setPlaybackRate(speed);
    }
  }
}