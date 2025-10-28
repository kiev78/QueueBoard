import { ToastService } from './toast.service';
import { ErrorSeverity } from './ErrorHandlerService';

describe('ToastService', () => {
  let service: ToastService;
  beforeEach(() => {
    service = new ToastService();
  });

  it('adds a toast', () => {
    service.show('Hello', ErrorSeverity.INFO, 1000);
    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].message).toBe('Hello');
  });

  it('auto-dismisses after duration', (done) => {
    service.show('Auto', ErrorSeverity.ERROR, 10);
    expect(service.toasts().length).toBe(1);
    setTimeout(() => {
      expect(service.toasts().length).toBe(0);
      done();
    }, 25);
  });

  it('manual dismiss works', () => {
    service.show('Dismiss me', ErrorSeverity.WARNING, 1000);
    const id = service.toasts()[0].id;
    service.dismiss(id);
    expect(service.toasts().length).toBe(0);
  });
});
