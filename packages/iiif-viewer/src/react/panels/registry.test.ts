import { describe, expect, it } from 'vitest';
import { OVERLAYS } from '../overlays/registry';
import { PANEL_IDS } from './registry';

describe('PANELS', () => {
  it('collects the panels from the folder, ordered by order', () => {
    expect(PANEL_IDS).toEqual([
      'metadata',
      'story',
      'pages',
      'structure',
      'layers',
      'map',
      'rights',
      'transcript',
      'annotationTranscript',
      'contentSearch',
      'canvasAnnotations',
      'annotations',
      'inference',
      'download',
      'puzzle',
    ]);
  });

  it('has no duplicate ids', () => {
    expect(new Set(PANEL_IDS).size).toBe(PANEL_IDS.length);
  });
});

describe('OVERLAYS', () => {
  it('collects the overlays from the folder', () => {
    expect(OVERLAYS.map((o) => o.id)).toEqual(['annotations', 'point-pick', 'story', 'view-region']);
  });
});
