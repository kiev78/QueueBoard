import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { jest } from '@jest/globals';

const global = globalThis as any;
const testEnvironmentOptions = global.ngJest?.testEnvironmentOptions ?? Object.create(null);
global.jest = jest;

// Polyfill TextEncoder/TextDecoder for Node.js environments
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

getTestBed().initTestEnvironment(
  BrowserTestingModule,
  platformBrowserTesting(),
  testEnvironmentOptions,
);

// Mock console methods to prevent output during tests
beforeEach(() => {
  jest.spyOn(global.console, 'log').mockImplementation(() => {});
  jest.spyOn(global.console, 'info').mockImplementation(() => {});
  jest.spyOn(global.console, 'warn').mockImplementation(() => {});
  jest.spyOn(global.console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

class MockBroadcastChannel {
  name: string;
  onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null = null;
  onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => any) | null = null;

  constructor(name: string) {
    this.name = name;
  }

  postMessage(message: any) {
    if (this.onmessage) {
      this.onmessage({ data: message } as MessageEvent);
    }
  }

  close() {
    // Close mock method
  }

  addEventListener(type: string, listener: (event: any) => void) {
    if (type === 'message') {
      this.onmessage = listener;
    } else if (type === 'messageerror') {
      this.onmessageerror = listener;
    }
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    if (type === 'message' && this.onmessage === listener) {
      this.onmessage = null;
    } else if (type === 'messageerror' && this.onmessageerror === listener) {
      this.onmessageerror = null;
    }
  }

  dispatchEvent(): boolean {
    // Mock dispatchEvent method
    return true;
  }
}

// Define the mock BroadcastChannel globally
Object.defineProperty(global, 'BroadcastChannel', {
  value: MockBroadcastChannel,
  writable: true,
});
