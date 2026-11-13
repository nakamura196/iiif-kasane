import { atom } from 'jotai';

// 右パネルの一覧と、画像の上の印で共有する「選ばれている注釈」。Viewer ごとの store に載る。
export const selectedCanvasAnnotationAtom = atom<string | null>(null);

// 右パネルの注釈の一覧で選んだ単位（Text Granularity の line・word など）。null はすべて。
// 画像の上の印も同じ単位に絞る。ただし文字の検索の当たり（highlighting）は、検索タブの側で絞る。
export const canvasAnnotationGranularityAtom = atom<string | null>(null);

// 閲覧者の手元で作った AnnotationPage（ブラウザ内の推論の結果など）。マニフェストには無いが、
// マニフェストの注釈と同じく、右パネルの一覧と画像の上の印に出す。Canvas ごとに、作った側の id で持つ。
export interface LocalAnnotationPage {
  /** Who made it (for example `inference:<model id>`). One page per maker and Canvas. */
  source: string;
  canvasId: string;
  page: unknown;
}

export const localAnnotationPagesAtom = atom<LocalAnnotationPage[]>([]);

// その Canvas の画像に重ねている、手元で作った AnnotationPage の数。ignore の作り手（文字の検索の印など）は数えない。
// 推論の結果は、画像に重ねている間だけここに入る（推論タブで隠すと抜ける）。
export const localPageCountOn = (pages: LocalAnnotationPage[], canvasId: string | undefined, ignore: string): number =>
  canvasId ? pages.filter((l) => l.canvasId === canvasId && l.source !== ignore).length : 0;

// 右パネルの注釈の検索欄の文字。画像の上の印も、当たった注釈だけに絞る。
export const canvasAnnotationQueryAtom = atom<string>('');

// 右パネルで選んだタグ（「キー: 値」）。どれか 1 つを持つ注釈だけを一覧と画像の上の印に出す。
// 今の Canvas に無いタグは無視する（別の Canvas へ移っても選択は残す）。
export const canvasAnnotationTagsAtom = atom<string[]>([]);

// 一覧で注釈を選んだとき、画像をその場所へ寄せるか（既定は寄せない）。
export const canvasAnnotationFocusOnSelectAtom = atom<boolean>(false);
