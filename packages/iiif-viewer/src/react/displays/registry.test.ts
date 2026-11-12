import { describe, expect, it } from 'vitest';
import type { ContainerInfo } from '../../core';
import { displayAfter, DISPLAYS } from './registry';

// コンバーターが Scene にした Canvas（回転した画像・Choice・欠けた画像）は painting が空になる。
// Collection の表示は、これに当たっても Collection でなければ後ろの表示に渡す。
describe('表示の振り分け', () => {
  const emptyScene = { id: 'c', kind: 'Scene', label: {}, painting: [], supplementing: [] } as unknown as ContainerInfo;

  it('空の Scene は Collection の表示に当たる', () => {
    expect(DISPLAYS.find((d) => d.match(emptyScene))?.id).toBe('collection');
  });

  it('Collection でなければ、画像の表示（imageCanvas）に渡る', () => {
    expect(displayAfter('collection', emptyScene)?.id).toBe('image-canvas');
  });
});

// 3D の表示は既定では案内だけ。iiif-kasane/scene の registerDisplay で同じ id の本物に差し替わる。
describe('表示の登録', () => {
  it('同じ id の表示は、元の位置で差し替わる', async () => {
    const { registerDisplay } = await import('./registry');
    const before = DISPLAYS.map((d) => d.id);
    const real = { id: 'scene', match: (c: ContainerInfo) => c.kind === 'Scene', Component: () => null };
    const placeholder = DISPLAYS.find((d) => d.id === 'scene');
    registerDisplay(real);
    expect(DISPLAYS.map((d) => d.id)).toEqual(before);
    expect(DISPLAYS.find((d) => d.id === 'scene')).toBe(real);
    if (placeholder) registerDisplay(placeholder);
  });

  it('新しい id の表示は、最後の受け皿（flat）の前に入る', async () => {
    const { registerDisplay } = await import('./registry');
    registerDisplay({ id: 'extra', match: () => false, Component: () => null });
    const ids = DISPLAYS.map((d) => d.id);
    expect(ids.indexOf('extra')).toBe(ids.length - 2);
    DISPLAYS.splice(ids.indexOf('extra'), 1);
  });
});
