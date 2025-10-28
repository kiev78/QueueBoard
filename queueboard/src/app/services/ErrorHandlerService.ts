import { Injectable, inject } from '@angular/core';
import { InputSanitizerService } from './InputSanitizerService';

export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export interface AppError {
  message: string;
  severity: ErrorSeverity;
  timestamp: Date;
  context?: string;
  originalError?: unknown;
}

/**
 * Centralized error handling service.
 * Safely formats and sanitizes error messages for display.
 */
@Injectable({
  providedIn: 'root',
})
export class ErrorHandlerService {
  private readonly MAX_USER_MESSAGE_LENGTH = 500;
  private sanitizer: InputSanitizerService;

  // Allow manual DI for Jest tests (outside Angular inject context)
  constructor(sanitizer?: InputSanitizerService) {
    this.sanitizer = sanitizer ?? inject(InputSanitizerService);
  }

  /**
   * Handles errors and returns a safe, user-friendly message
   */
  handleError(error: unknown, context?: string): AppError {
    const errorObj = this.normalizeError(error);
    const severity = this.determineSeverity(errorObj);
    const userMessage = this.createUserMessage(errorObj, severity);

    return {
      message: userMessage,
      severity,
      timestamp: new Date(),
      context,
      originalError: error,
    };
  }

  /**
   * Handles YouTube API specific errors
   */
  handleYouTubeError(error: unknown, operation: string): AppError {
    const apiError = this.extractApiError(error);

    let message = 'An error occurred while connecting to YouTube.';
    let severity = ErrorSeverity.ERROR;

    if (apiError) {
      switch (apiError.code) {
        case 401:
        case 403:
          message = 'Authentication failed. Please sign in again.';
          severity = ErrorSeverity.WARNING;
          break;
        case 404:
          message = 'The requested resource was not found.';
          severity = ErrorSeverity.WARNING;
          break;
        case 429:
          message = 'Too many requests. Please try again in a few moments.';
          severity = ErrorSeverity.WARNING;
          break;
        case 500:
        case 503:
          message = 'YouTube service is temporarily unavailable. Please try again later.';
          severity = ErrorSeverity.ERROR;
          break;
        default:
          message = `YouTube error: ${this.sanitizer.escapeHtml(
            apiError.message || 'Unknown error'
          )}`;
      }
    }

    return {
      message,
      severity,
      timestamp: new Date(),
      context: operation,
      originalError: error,
    };
  }

  /**
   * Normalizes any error type to a standard format
   */
  private normalizeError(error: unknown): { message: string; stack?: string; code?: number } {
    if (error instanceof Error) {
      return {
        message: error.message || 'An error occurred',
        stack: error.stack,
      };
    }

    if (typeof error === 'string') {
      return { message: error };
    }

    if (error && typeof error === 'object') {
      const obj = error as any;
      return {
        message: obj.message || obj.error || obj.statusText || 'Unknown error',
        code: obj.status || obj.code,
      };
    }

    return { message: 'An unknown error occurred' };
  }

  /**
   * Extracts API error information from gapi response
   */
  private extractApiError(error: unknown): { code: number; message: string } | null {
    try {
      const err = error as any;

      // gapi error structure
      if (err.result?.error) {
        return {
          code: err.result.error.code || err.status || 500,
          message: err.result.error.message || 'Unknown API error',
        };
      }

      // HTTP error structure
      if (err.status && typeof err.status === 'number') {
        return {
          code: err.status,
          message: err.statusText || `HTTP Error ${err.status}`,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Determines error severity based on error type
   */
  private determineSeverity(error: { message: string; code?: number }): ErrorSeverity {
    if (!error.code) {
      return ErrorSeverity.ERROR;
    }

    if (error.code >= 500) return ErrorSeverity.CRITICAL;
    if (error.code >= 400) return ErrorSeverity.WARNING;
    if (error.code >= 300) return ErrorSeverity.INFO;
    return ErrorSeverity.INFO;
  }

  /**
   * Creates a safe, user-friendly error message
   */
  private createUserMessage(error: { message: string }, severity: ErrorSeverity): string {
    let message = this.sanitizer.escapeHtml(error.message);

    // Truncate long messages
    if (message.length > this.MAX_USER_MESSAGE_LENGTH) {
      message = message.slice(0, this.MAX_USER_MESSAGE_LENGTH) + '...';
    }

    // Add helpful context for critical errors
    if (severity === ErrorSeverity.CRITICAL) {
      message += ' Please try again later or contact support if the problem persists.';
    }

    return message;
  }
}
