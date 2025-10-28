import { Injectable, computed, signal } from '@angular/core';
import { StorageService, StorageKey } from './StorageService';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private storage = inject(StorageService);
  private platformId = inject(PLATFORM_ID);
  private _darkMode = signal<boolean>(true);
  readonly darkMode = computed(() => this._darkMode());

  init(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this._darkMode.set(false);
      return;
    }
    const saved = this.storage.getItem(StorageKey.DARK_MODE);
    if (saved !== null) {
      this._darkMode.set(saved === 'true');
    } else {
      const prefersDark =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      this._darkMode.set(prefersDark);
    }
    this.apply();
  }

  toggle(): void {
    const next = !this._darkMode();
    this._darkMode.set(next);
    this.storage.setItem(StorageKey.DARK_MODE, String(next));
    this.apply();
  }

  private apply(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const body = document.body;
    const isDark = this._darkMode();
    body.classList.toggle('dark-mode', isDark);
  }
}
