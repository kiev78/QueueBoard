// import { describe, expect, it, beforeEach } from '@angular/core/testing';
// import { ErrorHandlerService, ErrorSeverity } from './ErrorHandlerService';

// // Simple helper to build oversized messages
// function makeLong(len: number): string {
//   return Array.from({ length: len })
//     .map((_, i) => `x${i}`)
//     .join('');
// }

// describe('ErrorHandlerService', () => {
//   let service: ErrorHandlerService;

//   beforeEach(() => {
//     service = new ErrorHandlerService({
//       // minimal sanitizer mock implementing escapeHtml
//       escapeHtml: (s: string) => {
//         if (!s || typeof s !== 'string') {
//           return '';
//         }
//         const map: Record<string, string> = {
//           '&': '&amp;',
//           '<': '&lt;',
//           '>': '&gt;',
//           '"': '&quot;',
//           "'": '&#039;',
//           '/': '&#x2F;',
//         };
//         return s.replace(/[&<>"'\/]/g, (char) => map[char] || char);
//       },
//     } as any);
//   });

//   describe('handleError()', () => {
//     it('should normalize a native Error', () => {
//       const err = new Error('Boom');
//       const result = service.handleError(err, 'test');
//       expect(result.message).toContain('Boom');
//       expect(result.severity).toBe(ErrorSeverity.ERROR); // no code => ERROR by default
//       expect(result.context).toBe('test');
//     });

//     it('should handle a plain string', () => {
//       const result = service.handleError('plain string');
//       expect(result.message).toBe('plain string');
//       expect(result.severity).toBe(ErrorSeverity.ERROR);
//     });

//     it('should extract message from object with message', () => {
//       const result = service.handleError({ message: 'Object error' });
//       expect(result.message).toBe('Object error');
//       expect(result.severity).toBe(ErrorSeverity.ERROR);
//     });

//     it('should fallback when object lacks message', () => {
//       const result = service.handleError({ something: 'else' });
//       expect(result.message).toBe('Unknown error');
//     });

//     it('should escape HTML content', () => {
//       const result = service.handleError('<script>alert(1)</script>');
//       // Escaped angle brackets
//       expect(result.message).toContain('&lt;script&gt;');
//       expect(result.message).not.toContain('<script>');
//     });

//     it('should truncate overly long messages and append ellipsis', () => {
//       const long = makeLong(600); // exceeds 500
//       const result = service.handleError(long);
//       expect(result.message.length).toBeLessThanOrEqual(503); // 500 + '...'
//       expect(result.message.endsWith('...')).toBe(true);
//     });

//     it('should append support guidance on CRITICAL severity', () => {
//       const result = service.handleError({ message: 'Server exploded', status: 500 });
//       expect(result.severity).toBe(ErrorSeverity.CRITICAL);
//       expect(result.message).toContain('Please try again later or contact support');
//     });

//     it('should map 4xx codes to WARNING severity', () => {
//       const result = service.handleError({ message: 'Not Authorized', status: 401 });
//       expect(result.severity).toBe(ErrorSeverity.WARNING);
//     });

//     it('should map 3xx codes to INFO severity', () => {
//       const result = service.handleError({ message: 'Redirect', status: 302 });
//       expect(result.severity).toBe(ErrorSeverity.INFO);
//     });

//     it('should map <=299 codes to INFO severity (no explicit code path)', () => {
//       const result = service.handleError({ message: 'OK', status: 200 });
//       // determineSeverity returns INFO for code < 300
//       expect(result.severity).toBe(ErrorSeverity.INFO);
//     });
//   });

//   describe('handleYouTubeError()', () => {
//     it('should produce auth failure message for 401', () => {
//       const result = service.handleYouTubeError(
//         { status: 401, statusText: 'Unauthorized' },
//         'auth',
//       );
//       expect(result.message).toContain('Authentication failed');
//       expect(result.severity).toBe(ErrorSeverity.WARNING);
//       expect(result.context).toBe('auth');
//     });

//     it('should produce not found message for 404', () => {
//       const result = service.handleYouTubeError({ status: 404 }, 'fetch');
//       expect(result.message).toContain('not found');
//       expect(result.severity).toBe(ErrorSeverity.WARNING);
//     });

//     it('should produce rate limit message for 429', () => {
//       const result = service.handleYouTubeError({ status: 429 }, 'quota');
//       expect(result.message).toContain('Too many requests');
//       expect(result.severity).toBe(ErrorSeverity.WARNING);
//     });

//     it('should produce service unavailable message for 503', () => {
//       const result = service.handleYouTubeError({ status: 503 }, 'service');
//       expect(result.message).toContain('temporarily unavailable');
//       expect(result.severity).toBe(ErrorSeverity.ERROR);
//     });

//     it('should fallback to generic connection message if structure missing', () => {
//       const result = service.handleYouTubeError('weird', 'generic');
//       expect(result.message).toContain('connecting to YouTube');
//       expect(result.severity).toBe(ErrorSeverity.ERROR);
//     });

//     it('should include sanitized message for unknown code path', () => {
//       const apiErr = { result: { error: { code: 777, message: '<b>Odd</b>' } } };
//       const result = service.handleYouTubeError(apiErr, 'unknown');
//       expect(result.message).toContain('YouTube error:');
//       // The sanitizer escapes '/' as '&#x2F;' so closing tag contains that sequence
//       expect(result.message).toContain('&lt;b&gt;Odd&lt;&#x2F;b&gt;');
//     });
//   });
// });
