// 見開きのページの画像は object-contain で描くので、<img> の矩形と、実際に絵が描かれた矩形が違う。
// 枠を重ねるときは、絵の矩形（要素の中で、Canvas の縦横比を保って収まる範囲。中央寄せ）を使う。

export interface PageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The part of an object-contain image element where the picture is drawn (centred, with the Canvas aspect). */
export function containedBox(el: PageBox, canvasWidth: number, canvasHeight: number): PageBox {
  if (!(canvasWidth > 0 && canvasHeight > 0 && el.width > 0 && el.height > 0)) return el;
  const scale = Math.min(el.width / canvasWidth, el.height / canvasHeight);
  const width = canvasWidth * scale;
  const height = canvasHeight * scale;
  return { left: el.left + (el.width - width) / 2, top: el.top + (el.height - height) / 2, width, height };
}

/** The box of `xywh` (Canvas pixels) on the drawn picture. */
export function regionBox(picture: PageBox, xywh: readonly number[], canvasWidth: number, canvasHeight: number): PageBox {
  return {
    left: picture.left + (xywh[0] / canvasWidth) * picture.width,
    top: picture.top + (xywh[1] / canvasHeight) * picture.height,
    width: (xywh[2] / canvasWidth) * picture.width,
    height: (xywh[3] / canvasHeight) * picture.height,
  };
}
