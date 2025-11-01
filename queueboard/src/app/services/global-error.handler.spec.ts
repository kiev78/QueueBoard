import { GlobalErrorHandler } from './global-error.handler';
import { ToastService } from './toast.service';
import { ErrorHandlerService, ErrorSeverity } from './ErrorHandlerService';
import { TestBed } from '@angular/core/testing';

describe('GlobalErrorHandler', () => {
  let handler: GlobalErrorHandler;
  let mockToastService: Partial<ToastService>;
  let mockErrorHandlerService: Partial<ErrorHandlerService>;

  beforeEach(() => {
    mockToastService = {
      show: jest.fn(),
      dismiss: jest.fn(),
      clear: jest.fn(),
      toasts: jest.fn().mockReturnValue([]),
    };

    mockErrorHandlerService = {
      handleError: jest.fn().mockReturnValue({
        message: 'Test error message',
        severity: ErrorSeverity.ERROR,
        timestamp: new Date(),
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        GlobalErrorHandler,
        { provide: ErrorHandlerService, useValue: mockErrorHandlerService },
        { provide: ToastService, useValue: mockToastService },
      ],
    });
    handler = TestBed.inject(GlobalErrorHandler);
  });

  it('should create', () => {
    expect(handler).toBeTruthy();
  });

  it('should handle error and show toast with ERROR severity', () => {
    const testError = new Error('Test error');

    handler.handleError(testError);

    expect(mockErrorHandlerService.handleError).toHaveBeenCalledWith(testError, 'global');
    expect(mockToastService.show).toHaveBeenCalledWith(
      'Test error message',
      ErrorSeverity.ERROR,
      8000,
    );
  });

  it('should handle error and show toast with CRITICAL severity when error handler returns CRITICAL', () => {
    const testError = new Error('Critical error');
    (mockErrorHandlerService.handleError as jest.Mock).mockReturnValue({
      message: 'Critical error message',
      severity: ErrorSeverity.CRITICAL,
      timestamp: new Date(),
    });

    handler.handleError(testError);

    expect(mockErrorHandlerService.handleError).toHaveBeenCalledWith(testError, 'global');
    expect(mockToastService.show).toHaveBeenCalledWith(
      'Critical error message',
      ErrorSeverity.CRITICAL,
      8000,
    );
  });

  it('should downgrade WARNING severity to ERROR for toast display', () => {
    const testError = new Error('Warning error');
    (mockErrorHandlerService.handleError as jest.Mock).mockReturnValue({
      message: 'Warning error message',
      severity: ErrorSeverity.WARNING,
      timestamp: new Date(),
    });

    handler.handleError(testError);

    expect(mockToastService.show).toHaveBeenCalledWith(
      'Warning error message',
      ErrorSeverity.ERROR,
      8000,
    );
  });

  it('should downgrade INFO severity to ERROR for toast display', () => {
    const testError = new Error('Info error');
    (mockErrorHandlerService.handleError as jest.Mock).mockReturnValue({
      message: 'Info error message',
      severity: ErrorSeverity.INFO,
      timestamp: new Date(),
    });

    handler.handleError(testError);

    expect(mockToastService.show).toHaveBeenCalledWith(
      'Info error message',
      ErrorSeverity.ERROR,
      8000,
    );
  });

  it('should handle errors thrown by ErrorHandlerService gracefully', () => {
    const testError = new Error('Test error');
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    (mockErrorHandlerService.handleError as jest.Mock).mockImplementation(() => {
      throw new Error('Handler failed');
    });

    expect(() => handler.handleError(testError)).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[GlobalErrorHandler] failed while handling error',
      expect.any(Error),
      'original:',
      testError,
    );

    consoleErrorSpy.mockRestore();
  });

  it('should log errors to console even when handling succeeds', () => {
    const testError = new Error('Test error');
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    handler.handleError(testError);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[GlobalErrorHandler]', testError);

    consoleErrorSpy.mockRestore();
  });
});
