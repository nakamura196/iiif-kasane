// ブラウザ内の推論で、モデルが返すもの。位置は推論に渡した画像の画素（左上が 0,0）。
// Canvas 座標への置き直しと、IIIF の Annotation への書き出しは annotationPage.ts が受け持つ。

/**
 * One thing a model found: a text line (with the text read) or a region (with a class name). An OCR result may hold
 * both: the lines it read and the other regions its layout detector found (figures, tables ...).
 */
export interface Detection {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Confidence, 0..1. */
  score: number;
  /** Class name for regions (layout, faces ...). */
  label?: string;
  /** Text read from the region (OCR). */
  text?: string;
  /** Outline of the thing inside the box (x, y in image pixels), when the model gives one. */
  polygon?: [number, number][];
}

export interface InferenceOutput {
  /**
   * `lines`: OCR text lines, in reading order. `regions`: boxes with a class name. `description`: text about the
   * whole image (one item, its box the whole image).
   */
  kind: 'lines' | 'regions' | 'description';
  items: Detection[];
  /** Size of the image the model was given (the coordinates of `items`). */
  imageWidth: number;
  imageHeight: number;
  /** BCP 47 language of the text, for OCR. */
  language?: string;
  /**
   * Every class name the model can give, in the model's own order. Fixes the color of each class, so a class keeps
   * its color from page to page. Labels outside the list get colors after it, in the order they appear.
   */
  classes?: readonly string[];
}
