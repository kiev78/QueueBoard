import { InjectionToken } from '@angular/core';

/**
 * When provided with a boolean true value, StorageService will prefer
 * localStorage (fallback) instead of attempting to use IndexedDB. This
 * is useful for tests or environments where IndexedDB should be disabled.
 */
export const FORCE_LOCAL_STORAGE = new InjectionToken<boolean>('FORCE_LOCAL_STORAGE');
