// import { GlobalErrorHandler } from './global-error.handler';
// import { ToastService } from './toast.service';
// import { ErrorHandlerService, ErrorSeverity } from './ErrorHandlerService';
// import { InputSanitizerService } from './InputSanitizerService';
// import { TestBed } from '@angular/core/testing';
// import { beforeEach, describe } from 'jest';

// describe('GlobalErrorHandler', () => {
//   let handler: GlobalErrorHandler;
//   let mockToastService: Partial<ToastService>;
//   let mockErrorHandlerService: Partial<ErrorHandlerService>;

//   beforeEach(() => {
//     mockToastService = {
//       show: jest.fn(),
//       dismiss: jest.fn(),
//       clear: jest.fn(),
//       toasts: jest.fn().mockReturnValue([]),
//     };

//     mockErrorHandlerService = {
//       handleError: jest.fn().mockReturnValue({
//         message: 'Test error message',
//         severity: ErrorSeverity.ERROR,
//         timestamp: new Date(),
//       }),
//     };

//     TestBed.configureTestingModule({
//       providers: [
//         GlobalErrorHandler,
//         { provide: ErrorHandlerService, useValue: mockErrorHandlerService },
//         { provide: ToastService, useValue: mockToastService },
//       ],
//     });
//     handler = TestBed.inject(GlobalErrorHandler);
//   });

//   it('shows toast for error', () => {
//     handler.handleError(new Error('Boom'));
//     expect(mockToastService.show).toHaveBeenCalled();
//     const showFn = mockToastService.show as jest.Mock;
//     const calls = showFn.mock.calls;
//     const [message, severity] = calls[calls.length - 1] as [string, ErrorSeverity];
//     expect(message).toContain('Test error message');
//     expect([ErrorSeverity.ERROR, ErrorSeverity.CRITICAL]).toContain(severity);
//   });
// });
