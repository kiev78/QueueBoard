import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { YouTubePlayerModule } from '@angular/youtube-player';
import { VideoCard } from '../organizer.component';

@Component({
  selector: 'app-minimized-videos',
  standalone: true,
  imports: [CommonModule, YouTubePlayerModule],
  templateUrl: './minimized-videos.component.html',
  styleUrls: ['./minimized-videos.component.scss']
})
export class MinimizedVideosComponent {
  @Input({ required: true }) videos: VideoCard[] = [];
  @Input() playerState: YT.PlayerState | null = null;

  @Output() restore = new EventEmitter<VideoCard>();
  @Output() close = new EventEmitter<VideoCard>();
  @Output() togglePlayPause = new EventEmitter<VideoCard>();
  @Output() playerReady = new EventEmitter<YT.PlayerEvent>();
  @Output() stateChange = new EventEmitter<YT.PlayerEvent>();
}