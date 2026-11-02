'use client';

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  type ContainerInfo,
  canvasImagesOf,
  compareDetailWidthOf,
  fitSide,
  rawCanvasOf,
  type AlignTransform,
  type CanvasImages,
  type CompareSide,
  type ImageLayer,
} from '../../core';
import {
  CompareChip,
  CompareHint,
  LensRing,
  SwipeHandle,
  compareClipOf,
  pointInBox,
  type CompareMode,
  type LensPoint,
  type SwipeDirection,
} from '../compare/CompareParts';
import { ImageLayers } from './ImageTiles';
import ImageView, { INITIAL_VIEW, OverlayLayer, stageStyleOf, zoomStageAt, type StageInfo, type ViewState } from './ImageView';
import { useRawManifest } from './rawManifest';
import WarpedLayer, { warpableLayer } from './WarpedLayer';

// 2 つの画像（Choice の 2 つの候補、または別々の資料の画像）を見比べる。
// 枠は A の大きさ。B は縦横比を保って A の枠に収め、中央に置く（大きさの違う 2 枚でも、拡大・移動が揃う）。
// 左右に並べる: 2 つの ImageView が同じ view（拡大・移動）を共有する。
// スワイプ・スパイグラス・重ねる: 1 つの ImageView に A を描き、その上に同じ大きさの舞台で B を描いて、
// B を clip-path（線の右側・丸い窓）か不透明度で切る。スパイグラスは窓の中だけ B を拡大できる（虫眼鏡）。
// 線・窓・ラベルの部品は 3D の比較と共通（compare/CompareParts）。
// 位置合わせ（alignB）があれば、B は枠に収めず、その変換で A の上に置く（版の違う 2 枚の線を揃える）。
// 重ねるときの合成（blend）: 差（同じ所が暗く、違う所が明るく出る）と、赤と青緑の色分け
// （A の墨を赤、B の墨を青緑にして掛け合わせる。両方にある線は黒、片方だけの線はその色で残る）。

/** How B is laid over A in the overlay mode. */
export type CompareBlend = 'normal' | 'difference' | 'tint';

/** The colour of the ink of each side in the `tint` blend. */
export const TINT_COLORS = ['#ff0000', '#00ffff'] as const;

const tintFilter = 'grayscale(1) contrast(1.6) brightness(1.15)';

// the box (in frame units) the layers cover
const boundsOf = (layers: ImageLayer[], w: number, h: number) => {
  const ts = layers.map((l) => l.target ?? { x: 0, y: 0, w, h });
  if (ts.length === 0) return { x: 0, y: 0, w, h };
  const x = Math.min(...ts.map((t) => t.x));
  const y = Math.min(...ts.map((t) => t.y));
  return { x, y, w: Math.max(...ts.map((t) => t.x + t.w)) - x, h: Math.max(...ts.map((t) => t.y + t.h)) - y };
};

const pct = (v: number) => `${v * 100}%`;

/** The images of one Canvas, read from the manifest as served (undefined while loading). */
export function useCanvasImages(iiifContent: string | null, canvasId: string | undefined): CanvasImages | undefined {
  const raw = useRawManifest(iiifContent);
  return useMemo(() => {
    const canvas = raw && canvasId ? rawCanvasOf(raw, canvasId) : undefined;
    return canvas ? canvasImagesOf(canvas) : undefined;
  }, [raw, canvasId]);
}

export interface ImageCompareViewProps {
  /** The two sides (A, B). A's size is the frame; see `choiceSidesOf` for a Choice of one Canvas. */
  sides: [CompareSide, CompareSide];
  mode: CompareMode;
  labels: [string, string];
  /** Spyglass magnification of B (1 = the same scale as A). */
  zoom?: number;
  /** Overlay: opacity of B (0 to 1). */
  opacity?: number;
  /** Accessible name of the swipe line, and the hint shown in spyglass mode. */
  swipeHandleLabel?: string;
  spyglassHint?: string;
  /** Swipe: B is right of a vertical line (default) or below a horizontal line. */
  swipeDirection?: SwipeDirection;
  /**
   * How B is laid on A: the matrix (from B's frame units into A's), and the grid that bends it further
   * (drawn on a canvas when B is one Image API image). Absent or null: B is fitted into A's frame.
   */
  alignB?: AlignTransform | null;
  /** Overlay: how B is laid over A (default `normal`: faded by `opacity`). */
  blend?: CompareBlend;
  /**
   * Drawn over the picture in Canvas positions, on both sides (e.g. the annotation boxes of the Canvas
   * whose Choice is compared). Not drawn over B when B is moved by `alignB` (its positions are A's).
   */
  extra?: ReactNode;
  /** The container whose overlays are drawn over A (and over each side, side by side). */
  container?: ContainerInfo;
}

export default function ImageCompareView({
  sides,
  mode,
  labels,
  zoom = 1,
  opacity = 0.5,
  swipeHandleLabel,
  spyglassHint,
  swipeDirection = 'horizontal',
  alignB,
  blend = 'normal',
  extra,
  container,
}: ImageCompareViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [split, setSplit] = useState(50); // swipe line, % from the left
  const [lens, setLens] = useState<LensPoint | null>(null);

  const { width, height } = sides[0];
  // aligned: B in its own units, moved by the transform; otherwise fitted into A's frame
  const b = useMemo(() => (alignB ? sides[1] : fitSide(sides[1], sides[0])), [sides, alignB]);
  const layers = [sides[0].layers, b.layers];
  const detail = compareDetailWidthOf(sides[0], b);
  const tint = mode === 'overlay' && blend === 'tint';

  if (!width || !height) return null;

  const warpLayer = alignB?.warp ? warpableLayer(b.layers) : undefined;

  const draw = (side: 0 | 1, stage: StageInfo) => {
    const plain = <ImageLayers layers={layers[side]} canvasWidth={width} canvasHeight={height} stage={stage} />;
    // the ink in a colour: grey picture, then the colour put on with `screen` (white stays white)
    const tinted = (node: ReactNode, box: { x: number; y: number; w: number; h: number }) =>
      tint ? (
        <div className="absolute inset-0" style={{ isolation: 'isolate' }}>
          <div className="absolute inset-0" style={{ filter: tintFilter }}>
            {node}
          </div>
          <div
            className="absolute"
            style={{
              left: pct(box.x / width),
              top: pct(box.y / height),
              width: pct(box.w / width),
              height: pct(box.h / height),
              background: TINT_COLORS[side],
              mixBlendMode: 'screen',
            }}
          />
        </div>
      ) : (
        node
      );
    // B moved by the matrix (frame units to CSS pixels of the stage, before its zoom)
    const moved = (node: ReactNode) => {
      if (side === 0 || !alignB) return node;
      const k = stage.stageW / width;
      const [m0, m1, m2, m3, m4, m5] = alignB.matrix;
      const style: CSSProperties = {
        transform: `matrix(${m0}, ${m1}, ${m2}, ${m3}, ${m4 * k}, ${m5 * k})`,
        transformOrigin: '0 0',
      };
      return (
        <div className="absolute inset-0" style={style} data-iiif-compare-aligned>
          {node}
        </div>
      );
    };
    if (side === 1 && alignB?.warp && warpLayer) {
      // B bent onto A's frame (the matrix and the grid); until it is ready, B moved by the matrix only
      const bent = (
        <WarpedLayer
          layer={warpLayer}
          bWidth={b.width}
          bHeight={b.height}
          aWidth={width}
          aHeight={height}
          transform={alignB as AlignTransform & { warp: NonNullable<AlignTransform['warp']> }}
          white={tint}
          fallback={moved(plain)}
        />
      );
      return tinted(bent, { x: 0, y: 0, w: width, h: height });
    }
    return moved(tinted(plain, boundsOf(layers[side], width, height)));
  };
  const chipB = tint ? <TintDot color={TINT_COLORS[1]} /> : null;

  if (mode === 'side') {
    return (
      <div className="relative w-full h-full flex flex-col sm:flex-row gap-px bg-[var(--ds-border)]">
        {([0, 1] as const).map((side) => (
          <div key={side} className="relative flex-1 min-w-0 min-h-0 bg-gray-100 dark:bg-gray-900">
            <ImageView
              canvasWidth={width}
              canvasHeight={height}
              detailWidth={detail}
              view={view}
              onViewChange={setView}
              extra={side === 0 || !alignB ? extra : undefined}
              container={container}
            >
              {(stage) => draw(side, stage)}
            </ImageView>
            <CompareChip className="left-3">
              {side === 0 ? 'A' : 'B'}: {labels[side]}
            </CompareChip>
          </div>
        ))}
      </div>
    );
  }

  // B over A, cut or faded in box coordinates
  const over = (stage: StageInfo) => {
    const at = lens ?? { x: stage.boxW / 2, y: stage.boxH / 2 };
    const s = mode === 'spyglass' && zoom !== 1 ? zoomStageAt(stage, zoom, at.x, at.y) : stage;
    const overlayStyle: CSSProperties =
      blend === 'difference' ? { mixBlendMode: 'difference' } : blend === 'tint' ? { mixBlendMode: 'multiply' } : { opacity };
    return (
      // swipe and spyglass hide A inside the cut, also where B paints nothing; overlay only fades B in
      // (or blends it with A: the difference, or the two inks multiplied)
      <div
        className={`absolute inset-0 pointer-events-none ${mode === 'overlay' ? '' : 'bg-gray-100 dark:bg-gray-900'}`}
        style={mode === 'overlay' ? overlayStyle : { clipPath: compareClipOf(mode, split, at, swipeDirection) }}
        data-iiif-compare-b
      >
        <div style={stageStyleOf(s)}>
          {draw(1, s)}
          {/* the annotations of the Canvas over B too (clicks go through to A's, at the same place) */}
          {!alignB && extra}
          {!alignB && container && <OverlayLayer container={container} canvasWidth={width} canvasHeight={height} stage={s} />}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={boxRef}
      className={`relative w-full h-full overflow-hidden ${tint ? 'bg-white' : 'bg-gray-100 dark:bg-gray-900'}`}
      style={{ isolation: 'isolate' }}
      onPointerMove={(e) => {
        if (mode === 'spyglass' && boxRef.current) setLens(pointInBox(boxRef.current, e));
      }}
    >
      <ImageView
        canvasWidth={width}
        canvasHeight={height}
        detailWidth={detail}
        view={view}
        onViewChange={setView}
        over={over}
        extra={extra}
        container={container}
      >
        {(stage) => draw(0, stage)}
      </ImageView>
      <CompareChip className="left-3">
        {tint && <TintDot color={TINT_COLORS[0]} />}A: {labels[0]}
      </CompareChip>
      {mode === 'swipe' && swipeDirection === 'vertical' ? (
        <CompareChip className="left-3" bottom>
          B: {labels[1]}
        </CompareChip>
      ) : (
        <CompareChip className="right-3">
          {chipB}B: {labels[1]}
        </CompareChip>
      )}
      {mode === 'spyglass' && <LensRing lens={lens} />}
      {mode === 'swipe' && (
        <SwipeHandle boxRef={boxRef} split={split} onSplit={setSplit} label={swipeHandleLabel} direction={swipeDirection} />
      )}
      {mode === 'spyglass' && spyglassHint && <CompareHint>{spyglassHint}</CompareHint>}
    </div>
  );
}

const TintDot = ({ color }: { color: string }) => (
  <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle border border-black/20" style={{ background: color }} aria-hidden />
);
