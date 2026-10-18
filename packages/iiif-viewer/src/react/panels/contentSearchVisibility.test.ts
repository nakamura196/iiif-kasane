import { describe, expect, it } from 'vitest';
import type { ContainerInfo, ManifestV4 } from '../../core';
import { canSearchLocal, contentSearchPanel } from './ContentSearchPanel';

const container = (kind: ContainerInfo['kind']): ContainerInfo =>
  ({ id: 'c', kind, label: {}, painting: [], supplementing: [] }) as ContainerInfo;
const withService = { service: [{ id: 'https://s.example/search', type: 'SearchService2' }] } as unknown as ManifestV4;

describe('content search tab visibility', () => {
  it('shows the tab for a Scene when the manifest has a SearchService2', () => {
    expect(contentSearchPanel.available({ container: container('Scene'), manifest: withService })).toBe(true);
  });

  it('hides the tab for a Scene without a service and without annotations', () => {
    expect(contentSearchPanel.available({ container: container('Scene'), manifest: {} as ManifestV4, annotationCount: 0 })).toBe(false);
  });

  it('searches Scene annotations locally only when there are some', () => {
    expect(canSearchLocal({ container: container('Scene'), annotationCount: 4 })).toBe(true);
    expect(canSearchLocal({ container: container('Scene'), annotationCount: 0 })).toBe(false);
  });

  it('does not use the Scene annotation count for a Canvas', () => {
    expect(canSearchLocal({ container: container('Canvas'), manifest: {} as ManifestV4, annotationCount: 4 })).toBe(false);
    expect(canSearchLocal({ container: container('Canvas'), manifest: {} as ManifestV4, localAnnotationCount: 1 })).toBe(true);
  });
});
