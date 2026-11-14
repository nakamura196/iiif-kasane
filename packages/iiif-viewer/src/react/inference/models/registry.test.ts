import { describe, expect, it } from 'vitest';
import { ppocrV6, ppocrV6Medium } from './ppocrV6';
import { MODELS, modelById } from './registry';

describe('inference model registry', () => {
  it('gives every model its own id', () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pins every Hugging Face file to a fixed revision, so a cached file never goes stale', () => {
    const urls = MODELS.flatMap((m) => m.files.flatMap((f) => [f.url, ...(f.data ? [f.data.url] : [])]));
    for (const url of urls.filter((u) => u.includes('huggingface.co'))) expect(url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
  });

  it('keeps PP-OCRv6 small under its old id and adds medium beside it', () => {
    expect(modelById('ppocrv6')).toBe(ppocrV6);
    expect(modelById('ppocrv6-medium')).toBe(ppocrV6Medium);
    expect(MODELS.indexOf(ppocrV6Medium)).toBe(MODELS.indexOf(ppocrV6) + 1);
    // Same runner and character list; only the weights differ
    expect(ppocrV6Medium.load).toBe(ppocrV6.load);
    expect(ppocrV6Medium.files.map((f) => f.name)).toEqual(ppocrV6.files.map((f) => f.name));
    expect(ppocrV6Medium.files.map((f) => f.url)).not.toEqual(ppocrV6.files.map((f) => f.url));
  });
});
