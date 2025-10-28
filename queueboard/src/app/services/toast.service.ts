import { Injectable, signal } from '@angular/core';
import { ErrorSeverity } from './ErrorHandlerService';

export interface ToastMessage {
  id: string;
  message: string;
  severity: ErrorSeverity;
  createdAt: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<ToastMessage[]>([]);
  toasts() {
    return this._toasts();
  }

  show(message: string, severity: ErrorSeverity = ErrorSeverity.ERROR, durationMs: number = 4000) {
    if (!message) return;
    const id = 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const toast: ToastMessage = { id, message, severity, createdAt: Date.now() };
    this._toasts.update((list) => [...list, toast]);
    const timeout = severity === ErrorSeverity.CRITICAL ? durationMs * 2 : durationMs;
    setTimeout(() => this.dismiss(id), timeout);
  }

  dismiss(id: string) {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  clear() {
    this._toasts.set([]);
  }
}
