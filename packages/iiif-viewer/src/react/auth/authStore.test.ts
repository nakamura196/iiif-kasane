import { afterEach, describe, expect, it, vi } from 'vitest';
import { getController } from './authStore';

describe('getController', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is one Controller per probe, and a new content language can be set on it', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const probe = { id: 'https://example.org/auth-test/probe', access: [] } as never;
    const a = getController(probe, 'ja');
    expect(a.language).toBe('ja');
    const b = getController(probe, 'zh,ja');
    expect(b).toBe(a);
    b.setLocale('zh,ja'); // what the hooks do in an effect
    expect(b.language).toBe('zh,ja');
  });
});
