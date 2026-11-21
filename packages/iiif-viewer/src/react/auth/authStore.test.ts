import { afterEach, describe, expect, it, vi } from 'vitest';
import { getController } from './authStore';

describe('getController', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is one Controller per probe, and it follows a new content language', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const probe = { id: 'https://example.org/auth-test/probe', access: [] } as never;
    const a = getController(probe, 'ja');
    expect(a.language).toBe('ja');
    const b = getController(probe, 'zh,ja');
    expect(b).toBe(a);
    expect(b.language).toBe('zh,ja');
  });
});
