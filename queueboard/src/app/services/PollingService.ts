import { Injectable, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, interval, switchMap, catchError, of, startWith } from 'rxjs';
import { environment } from '../../env/environment';

/**
 * Service for managing polling intervals with automatic cleanup.
 * Uses RxJS for better lifecycle management and error handling.
 */
@Injectable()
export class PollingService {
  private destroyRef = inject(DestroyRef);
  private pollingSubject = new Subject<void>();

  /**
   * Starts polling with automatic cleanup on component destroy
   * @param callback Function to call on each interval
   * @param intervalMinutes Interval in minutes (defaults to environment setting)
   */
  startPolling(callback: () => void, intervalMinutes?: number): void {
    const minutes = intervalMinutes ?? environment.pollingIntervalMinutes;
    const milliseconds = minutes * 60 * 1000;

    this.pollingSubject
      .pipe(
        startWith(null), // Execute immediately on subscription
        switchMap(() => interval(milliseconds)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.executeCallback(callback);
        },
        error: (error) => {
          console.error('[PollingService] Polling error:', error);
        }
      });
  }

  /**
   * Stops polling
   */
  stopPolling(): void {
    this.pollingSubject.complete();
  }

  /**
   * Triggers polling manually
   */
  trigger(): void {
    this.pollingSubject.next();
  }

  /**
   * Safely executes callback with error handling
   */
  private executeCallback(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      console.error('[PollingService] Error executing callback:', error);
    }
  }
}