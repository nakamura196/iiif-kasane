import { describe, expect, it } from 'vitest';
import { resolveSceneEnvironment } from './SceneEnvironment';

describe('resolveSceneEnvironment', () => {
  it('uses the built-in environment by default (no network request)', () => {
    expect(resolveSceneEnvironment(undefined)).toEqual({ kind: 'built-in' });
    expect(resolveSceneEnvironment('')).toEqual({ kind: 'built-in' });
    expect(resolveSceneEnvironment('built-in')).toEqual({ kind: 'built-in' });
  });

  it('turns the environment map off with "none"', () => {
    expect(resolveSceneEnvironment('none')).toEqual({ kind: 'none' });
  });

  it('keeps drei presets as an explicit opt-in', () => {
    expect(resolveSceneEnvironment('city')).toEqual({ kind: 'preset', preset: 'city' });
  });

  it('reads URLs and .hdr / .exr paths as files', () => {
    expect(resolveSceneEnvironment('https://example.org/env.hdr')).toEqual({
      kind: 'file',
      url: 'https://example.org/env.hdr',
    });
    expect(resolveSceneEnvironment('/assets/studio.exr')).toEqual({ kind: 'file', url: '/assets/studio.exr' });
    expect(resolveSceneEnvironment('studio_small.hdr')).toEqual({ kind: 'file', url: 'studio_small.hdr' });
  });

  it('falls back to the built-in environment for unknown words', () => {
    expect(resolveSceneEnvironment('sparkly')).toEqual({ kind: 'built-in' });
  });
});
