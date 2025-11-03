import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, ToastMessage } from '../services/toast.service';
import { ErrorSeverity } from '../services/ErrorHandlerService';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container position-fixed bottom-0 end-0 p-3">
      @for (toast of toasts(); track toast.id) {
        <div class="toast show" [ngClass]="getToastClass(toast.severity)">
          <div class="d-flex">
            <div class="toast-body">{{ toast.message }}</div>
            <button type="button" class="btn-close me-2 m-auto" (click)="dismiss(toast.id)"></button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      z-index: 1200;
    }
    .toast {
      width: 350px;
    }
  `]
})
export class ToastComponent {
  private toastService = inject(ToastService);
  toasts = this.toastService.toasts;

  dismiss(id: string) {
    this.toastService.dismiss(id);
  }

  getToastClass(severity: ErrorSeverity): string {
    switch (severity) {
      case ErrorSeverity.INFO:
        return 'bg-info text-dark';
      case ErrorSeverity.WARNING:
        return 'bg-warning text-dark';
      case ErrorSeverity.ERROR:
        return 'bg-danger text-white';
      case ErrorSeverity.CRITICAL:
        return 'bg-danger text-white fw-bold';
      default:
        return 'bg-secondary text-white';
    }
  }
}
