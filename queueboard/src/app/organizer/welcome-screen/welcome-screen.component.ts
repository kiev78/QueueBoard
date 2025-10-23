import { Component, Input, Output, EventEmitter, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-welcome-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: 'welcome-screen.component.html',
  styleUrls: ['welcome-screen.component.scss']
})
export class WelcomeScreenComponent {
  @Input({ required: true }) connecting!: Signal<boolean>;
  @Output() connectYouTube = new EventEmitter<void>();
}