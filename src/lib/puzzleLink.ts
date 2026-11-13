import { DEFAULT_PUZZLE_SIZE, PUZZLE_SIZES } from 'iiif-kasane';
import { contentParam } from 'iiif-kasane/core';

// パズルを共有するリンク: /viewer?iiif-content=<マニフェスト>&puzzle=<ページ>&grid=<マスの数>
// puzzle は 1 から数えるページの番号（人が読み書きする値なので）。grid は省くと 4 × 4。
// 開くと、そのページへ移り、「ほかの表示」タブでパズルが始まる。

export interface PuzzleLink {
  /** 0 から数える Canvas の番号。 */
  index: number;
  size: number;
}

/** URL の引数から、開くパズルを読む。puzzle が無い・読めないときは null。grid が読めなければ既定の大きさ。 */
export function puzzleFromParams(params: URLSearchParams): PuzzleLink | null {
  const raw = params.get('puzzle');
  if (raw === null) return null;
  // ?puzzle だけ（値なし）は 1 ページ目
  const page = raw === '' ? 1 : Number(raw);
  if (!Number.isInteger(page) || page < 1) return null;
  const grid = Number(params.get('grid'));
  const size = PUZZLE_SIZES.includes(grid) ? grid : DEFAULT_PUZZLE_SIZE;
  return { index: page - 1, size };
}

/** パズルを開くリンクの引数（? は含まない）。 */
export function puzzleQuery(manifestUrl: string, index: number, size: number): string {
  return `${contentParam(manifestUrl)}&puzzle=${index + 1}&grid=${size}`;
}
