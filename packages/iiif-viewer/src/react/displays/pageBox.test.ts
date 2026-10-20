import { describe, expect, it } from 'vitest';
import { containedBox, regionBox } from './pageBox';

describe('containedBox', () => {
  it('finds the picture of a wide Canvas in a tall element (letterboxed top and bottom)', () => {
    // 国文研 200003803 の見開き: Canvas 5616×3744 が、490×817 の要素に収まる
    const b = containedBox({ left: 490, top: 83, width: 490, height: 817 }, 5616, 3744);
    expect(b.width).toBeCloseTo(490);
    expect(b.height).toBeCloseTo(490 * (3744 / 5616));
    expect(b.left).toBeCloseTo(490);
    expect(b.top).toBeCloseTo(83 + (817 - b.height) / 2);
  });

  it('finds the picture of a tall Canvas in a wide element (pillarboxed left and right)', () => {
    const b = containedBox({ left: 0, top: 0, width: 400, height: 200 }, 1000, 2000);
    expect(b).toEqual({ left: 150, top: 0, width: 100, height: 200 });
  });

  it('keeps the element box when the aspect already matches or the size is unknown', () => {
    const el = { left: 10, top: 20, width: 300, height: 200 };
    expect(containedBox(el, 600, 400)).toEqual(el);
    expect(containedBox(el, 0, 0)).toEqual(el);
  });
});

describe('regionBox', () => {
  it('places xywh on the drawn picture', () => {
    const picture = { left: 100, top: 50, width: 561.6, height: 374.4 };
    expect(regionBox(picture, [2371, 2100, 117, 532], 5616, 3744)).toEqual({
      left: 100 + 237.1,
      top: 50 + 210,
      width: expect.closeTo(11.7),
      height: expect.closeTo(53.2),
    });
  });
});
