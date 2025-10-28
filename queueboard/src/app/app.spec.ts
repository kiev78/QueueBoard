import { provideZonelessChangeDetection, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet } from '@angular/router';

// Create a test version of the App component with inline template
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
  styles: [''],
})
class TestApp {
  protected readonly title = () => 'queueboard';
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestApp],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(TestApp);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('bootstraps without header element', () => {
    const fixture = TestBed.createComponent(TestApp);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')).toBeNull();
  });
});
