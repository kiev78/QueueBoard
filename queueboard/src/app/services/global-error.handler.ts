import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ErrorHandlerService, ErrorSeverity } from './ErrorHandlerService';
import { ToastService } from './toast.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private toast = inject(ToastService);
  private appErrorHandler = inject(ErrorHandlerService);

  handleError(error: unknown): void {
    try {
      const appErr = this.appErrorHandler.handleError(error, 'global');
      // Surface critical & error via toast; downgrade info/warning as needed
      const severity =
        appErr.severity === ErrorSeverity.CRITICAL ? ErrorSeverity.CRITICAL : ErrorSeverity.ERROR;
      this.toast.show(appErr.message, severity, 8000);
      // Still log full error for debugging
      // eslint-disable-next-line no-console
      console.error('[GlobalErrorHandler]', error);
    } catch (e) {
      // Fallback minimal logging
      // eslint-disable-next-line no-console
      console.error('[GlobalErrorHandler] failed while handling error', e, 'original:', error);
    }
  }
}
