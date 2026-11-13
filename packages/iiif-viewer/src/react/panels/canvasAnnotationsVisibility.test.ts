import { describe, expect, it } from 'vitest';
import type { ContainerInfo, ManifestV4 } from '../../core';
import { localPageCountOn, type LocalAnnotationPage } from '../overlays/canvasAnnotationState';
import { canvasAnnotationsPanel } from './CanvasAnnotationsPanel';
import { CONTENT_SEARCH_SOURCE } from './ContentSearchPanel';

const container = (kind: ContainerInfo['kind'], id = 'c1'): ContainerInfo =>
  ({ id, kind, label: {}, painting: [], supplementing: [] }) as ContainerInfo;
const bare = {
  id: 'm',
  type: 'Manifest',
  items: [
    { id: 'c1', type: 'Canvas', items: [] },
    { id: 'c2', type: 'Canvas', items: [] },
  ],
} as unknown as ManifestV4;

const local = (canvasId: string, source = 'inference:ndl-ocr-lite'): LocalAnnotationPage => ({ source, canvasId, page: {} });

// Info.tsx と同じ組み立て方で、タブが出るかを見る
const shown = (pages: LocalAnnotationPage[], c: ContainerInfo) =>
  canvasAnnotationsPanel.available({
    container: c,
    manifest: bare,
    localAnnotationCount: pages.length,
    containerLocalAnnotationCount: localPageCountOn(pages, c.id, CONTENT_SEARCH_SOURCE),
  });

describe('canvas annotations tab visibility', () => {
  it('hides the tab when the manifest has no annotations and nothing was made in the browser', () => {
    expect(shown([], container('Canvas'))).toBe(false);
  });

  // 推論の結果（ページ一覧の全ページ実行・推論タブ）は画像に重なるのに、一覧のタブが出なかった
  it('shows the tab for annotations made in the browser on this page, such as inference results', () => {
    expect(shown([local('c1')], container('Canvas', 'c1'))).toBe(true);
  });

  // 一覧は今のページの分だけなので、ほかのページの結果ではタブを出さない（空の一覧になる）
  it('does not show the tab for results on other pages', () => {
    expect(shown([local('c1')], container('Canvas', 'c2'))).toBe(false);
  });

  it('does not count search marks', () => {
    expect(shown([local('c1', CONTENT_SEARCH_SOURCE)], container('Canvas', 'c1'))).toBe(false);
  });

  it('never shows the tab for a Scene', () => {
    expect(shown([local('c1')], container('Scene', 'c1'))).toBe(false);
  });
});
