'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  canvasImagesOf,
  detailWidthOf,
  imageChoiceOf,
  paintsImage,
  physdimOf,
  rawCanvasOf,
  type CanvasImages,
  type CanvasPainting,
  type ImageAnnotation,
  isLayerVisible,
  layerItemsOf,
  layerOpacity,
  nextPlaybackStep,
  playbackStepCount,
  orderLayers,
  playbackSettings,
  type PaintingContent,
  type Physdim,
  youTubeIdOf,
} from '../../core';
import {
  canvasLayersAtom,
  layerOrderAtom,
  layerPlaybackAtom,
  layerPlaybackOptionsAtom,
  layerSettingsAtom,
} from '../atoms';
import { useTranslations } from '../env';
import { usePlayback } from '../playback';
import ChoiceBar from './ChoiceBar';
import AuthPrompt from '../auth/AuthPrompt';
import { useAuthPanels } from '../auth/authStore';
import { AnnotationBoxes, MediaCover } from './ImageExtras';
import ImageLayerView from './ImageTiles';
import { LoadingChip, LoadingOverlay } from '../layout/Loading';
import ImageView from './ImageView';
import PhysicalRuler from './PhysicalRuler';
import { useRawManifest } from './rawManifest';
import { useVideoPoster } from './videoPoster';
import Waveform from './Waveform';
import { DISPLAYS } from './registry';
import type { Display, DisplayProps } from './types';

// Canvas 全体を「元の manifest のまま」読んで表示する。
// 画像の Image API による深いズーム・回転・合成・Choice・画像を持つ注釈・placeholderCanvas・
// accompanyingCanvas・サムネイル・画像が無い Canvas を扱う。
// 音声は accompanyingCanvas（無ければ placeholderCanvas）の絵を出し、どちらも無ければ波形を出す（Waveform.tsx）。
//
// なぜ元の manifest を取り直すか: 読み込み時の変換（convertToV4）と ContainerInfo は、Canvas の
// 大きさ・Image API の service・SpecificResource（回転や領域）・注釈の位置を落とすため。
// 取り直しはブラウザのキャッシュに当たる。取れなかったときは、変換後の manifest で続ける。


const hasKind = (p: CanvasPainting, ...kinds: string[]) => p.options.some((o) => kinds.includes(o.kind));

const nextDisplay = (props: DisplayProps): Display | undefined => {
  const i = DISPLAYS.findIndex((d) => d.id === imageCanvasDisplay.id);
  return DISPLAYS.slice(i + 1).find((d) => d.match(props.container));
};

// ---- an image Canvas

function ImageBody({
  props,
  images,
  paintings,
  physdim,
}: {
  props: DisplayProps;
  images: CanvasImages;
  paintings: CanvasPainting[];
  physdim?: Physdim;
}) {
  const t = useTranslations('Viewer');
  const { container } = props;
  const [failedBase, setFailedBase] = useState(false);
  // the bottom image whose picture has come (until then the ring is shown), and its tiles still coming
  const [shownBase, setShownBase] = useState<string | null>(null);
  const [pendingTiles, setPendingTiles] = useState(0);
  // 認証の確認中・案内中は、画像が届かないのが当然なので「読み込めませんでした」を出さない
  const authPending = useAuthPanels().some(({ state }) => state.phase !== 'ok');
  const settings = useAtomValue(layerSettingsAtom);
  const setSettings = useSetAtom(layerSettingsAtom);
  const order = useAtomValue(layerOrderAtom)[container.id];
  const setCanvasLayers = useSetAtom(canvasLayersAtom);

  // every image (each option of a Choice too) is a layer; the Layers tab changes how they are drawn
  const items = useMemo(() => layerItemsOf(paintings), [paintings]);
  useEffect(() => {
    setCanvasLayers({ canvasId: container.id, items });
  }, [container.id, items, setCanvasLayers]);

  // レイヤーの再生（右パネルのレイヤーのタブで始める）。タブを閉じても、ここで進める
  const [playback, setPlayback] = useAtom(layerPlaybackAtom);
  const { seconds, loop } = useAtomValue(layerPlaybackOptionsAtom);
  const playing = playback && playback.canvasId === container.id ? playback : null;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      const count = playbackStepCount(playing.groups);
      const step = nextPlaybackStep(playing.step, count, loop);
      if (step === null) {
        setPlayback(null);
        return;
      }
      setSettings((s) => playbackSettings(s, playing.ids, playing.groups, step, playing.direction));
      // 繰り返さないときは、最後の段を出したところで止める
      setPlayback(!loop && step === count - 1 ? null : { ...playing, step });
    }, seconds * 1000);
    return () => clearTimeout(timer);
  }, [playing, seconds, loop, setSettings, setPlayback]);
  // 別の Canvas に移ったら止める
  useEffect(
    () => () => setPlayback((p) => (p && p.canvasId === container.id ? null : p)),
    [container.id, setPlayback],
  );

  const drawn = orderLayers(items, order).filter((it) => isLayerVisible(it, settings));
  const annotations: ImageAnnotation[] = [...drawn.flatMap((it) => it.layer.annotations), ...images.annotations];

  // a Choice also gets the quick switch above the image: showing one option hides the others
  const choiceIndex = (p: CanvasPainting) =>
    Math.max(
      0,
      items.filter((it) => it.paintingId === p.id).findIndex((it) => isLayerVisible(it, settings)),
    );
  const choose = (p: CanvasPainting, index: number) =>
    setSettings((s) => {
      const next = { ...s };
      for (const it of items.filter((x) => x.paintingId === p.id)) {
        next[it.id] = { ...next[it.id], visible: it.optionIndex === index };
      }
      return next;
    });
  const bars = paintings
    .filter((p) => p.options.length > 1)
    .map((p) => ({
      painting: p,
      content: {
        id: p.id,
        label: p.label,
        options: p.options.map((o) => ({ url: o.url, kind: 'Image' as const, label: o.label })),
      } satisfies PaintingContent,
    }));

  const { width, height } = images;
  // the same for every visibility and order, so switching layers keeps the zoom
  const key = items.map((it) => it.layer.url).join('|');
  const base = items[0]?.id;
  const baseLayer = drawn.find((it) => it.id === base)?.layer;
  const baseShown = !!baseLayer && shownBase === baseLayer.url;
  // only for an image that is drawn, has a size and is not waiting for a login
  const waitingBase = !!baseLayer && !!width && !!height && !baseShown && !failedBase && !authPending;
  const compared = imageChoiceOf(images);

  return (
    <>
      {bars.map((b) => (
        <ChoiceBar
          key={b.content.id}
          painting={b.content}
          index={choiceIndex(b.painting)}
          onChange={(i) => choose(b.painting, i)}
        >
          {/* the Choice the comparison page compares */}
          {b.content.id === compared?.id &&
            props.renderActions?.({ iiifContent: props.iiifContent, hasChoices: true, selectedIndex: props.selectedIndex })}
        </ChoiceBar>
      ))}
      <div className="relative flex-1 min-h-0 min-w-0">
        {width && height ? (
          <ImageView
            key={key}
            canvasWidth={width}
            canvasHeight={height}
            detailWidth={detailWidthOf(items.map((it) => it.layer))}
            container={container}
            extra={<AnnotationBoxes annotations={annotations} canvasWidth={width} canvasHeight={height} />}
            over={
              physdim
                ? (stage) => <PhysicalRuler physdim={physdim} canvasWidth={width} canvasHeight={height} stage={stage} />
                : undefined
            }
          >
            {(stage) =>
              drawn.map((it) => (
                <ImageLayerView
                  key={it.id}
                  layer={it.layer}
                  canvasWidth={width}
                  canvasHeight={height}
                  stage={stage}
                  opacity={layerOpacity(it, settings)}
                  onFailed={it.id === base ? () => setFailedBase(true) : undefined}
                  // ログイン前に失敗していても、ログイン後に読めたら「読み込めませんでした」を消す
                  onLoaded={
                    it.id === base
                      ? () => {
                          setFailedBase(false);
                          setShownBase(it.layer.url);
                        }
                      : undefined
                  }
                  onTilesPending={it.id === base ? setPendingTiles : undefined}
                  showLoading={false}
                />
              ))
            }
          </ImageView>
        ) : (
          // neither the Canvas nor the image says how big it is: the plain image
          drawn[0] && <ImageView key={drawn[0].layer.url} src={drawn[0].layer.url} container={container} />
        )}
        <AuthPrompt />
        {failedBase && items.length === 1 && !authPending && <FailedHint />}
        {waitingBase && <LoadingOverlay label={t('imageLoading')} />}
        {!waitingBase && baseShown && pendingTiles > 0 && <LoadingChip label={t('imageSharpening')} />}
      </div>
    </>
  );
}

function FailedHint() {
  const t = useTranslations('Viewer');
  return (
    <div className="absolute inset-0 grid place-items-center text-sm text-[var(--ds-fg)]" role="alert">
      {t('imageError')}
    </div>
  );
}

// ---- a Canvas that paints no image (missing, or only video / audio)

function Missing({ images }: { images: CanvasImages }) {
  const t = useTranslations('Viewer');
  const ratio = images.width && images.height ? images.width / images.height : 0.7;
  return (
    <div className="relative flex-1 min-h-0 min-w-0 grid place-items-center p-4">
      <div
        className="grid place-items-center border-2 border-dashed border-[var(--ds-border)] text-sm text-[var(--ds-fg)] text-center p-4 max-w-full max-h-full"
        style={{ aspectRatio: ratio, height: '80%' }}
        role="status"
      >
        {t('missingImage')}
      </div>
    </div>
  );
}

function CompanionPicture({ companion }: { companion: NonNullable<CanvasImages['accompanying']> }) {
  const w = companion.width ?? companion.layer.width;
  const h = companion.height ?? companion.layer.height;
  if (!w || !h) return <ImageView src={companion.layer.url} />;
  return (
    <ImageView canvasWidth={w} canvasHeight={h} detailWidth={companion.layer.width}>
      {(stage) => <ImageLayerView layer={companion.layer} canvasWidth={w} canvasHeight={h} stage={stage} />}
    </ImageView>
  );
}

function MediaBody({ props, images, kind }: { props: DisplayProps; images: CanvasImages; kind: 'Video' | 'Audio' }) {
  const next = nextDisplay(props);
  const { mediaRef, currentTime } = usePlayback();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  // 表紙が無い動画は、動画の途中から絵を取って表紙にする
  const own = kind === 'Video' ? images.placeholder?.layer.url ?? images.thumbnail : undefined;
  // YouTube の動画は YouTube のプレーヤーが自前の表紙と再生ボタンを出すので、表紙は重ねない
  const youTube = kind === 'Video' && images.paintings.some((p) => p.options.some((o) => o.kind === 'Video' && youTubeIdOf(o.url)));
  const video = kind === 'Video' && !youTube && !own && !images.accompanying
    ? images.paintings.flatMap((p) => p.options).find((o) => o.kind === 'Video')?.url
    : undefined;
  const still = useVideoPoster(video);
  if (!next) return null;
  const Next = next.Component;

  const companion = images.accompanying ?? (kind === 'Audio' ? images.placeholder : undefined);
  if (companion) {
    // the picture that goes with the sound (or video): above the player
    return (
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        <div className={kind === 'Audio' ? 'relative flex-1 min-h-0' : 'relative flex-1 min-h-0 basis-1/2'}>
          <CompanionPicture companion={companion} />
        </div>
        <div className={kind === 'Audio' ? 'shrink-0 flex flex-col' : 'flex-1 min-h-0 flex flex-col basis-1/2'}>
          <Next {...props} />
        </div>
      </div>
    );
  }

  // a sound with no picture to go with it: Kasane's own choice (the specification says nothing) is its waveform
  const sound = kind === 'Audio' ? images.paintings.flatMap((p) => p.options).find((o) => o.kind === 'Audio') : undefined;
  if (sound) {
    return (
      <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
        <Waveform src={sound.url} player={<Next {...props} />} />
      </div>
    );
  }

  // a video shows its placeholder (or thumbnail, or a still taken from it) until it is played
  return (
    <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
      <Next {...props} />
      {kind === 'Video' && !youTube && (
        <MediaCover
          src={own ?? still}
          dismissed={dismissedId === props.container.id || currentTime > 0}
          onDismiss={() => setDismissedId(props.container.id)}
          onPlay={() => {
            mediaRef.current?.play()?.catch(() => {});
          }}
        />
      )}
    </div>
  );
}

// ---- the display

function ImageCanvasDisplay(props: DisplayProps) {
  const t = useTranslations('Viewer');
  const raw = useRawManifest(props.iiifContent);
  const { container } = props;

  // before the source manifest arrives, a converted Canvas (a Scene) is not yet known to be flat
  const waiting = raw === undefined && container.kind === 'Scene';
  const source = useMemo(() => rawCanvasOf(raw ?? props.manifest, container.id), [raw, props.manifest, container.id]);
  const images = useMemo(() => canvasImagesOf(source), [source]);
  const physdim = useMemo(() => physdimOf(source), [source]);
  const imagePaintings = useMemo(() => images.paintings.filter(paintsImage), [images]);

  if (waiting) {
    return (
      <div className="relative flex-1 min-h-0 min-w-0">
        <LoadingOverlay label={t('imageLoading')} />
      </div>
    );
  }

  const delegate = () => {
    const next = nextDisplay(props);
    return next ? <next.Component {...props} /> : null;
  };

  // a real 3D Scene (without a model yet), or a type this display does not read
  if (!source || source.type === 'Scene') return delegate();

  const mediaPainting = images.paintings.find((p) => hasKind(p, 'Video', 'Audio'));

  let body: React.ReactNode;
  if (imagePaintings.length > 0) {
    body = <ImageBody props={props} images={images} paintings={imagePaintings} physdim={physdim} />;
  } else if (mediaPainting) {
    const kind = mediaPainting.options.find((o) => o.kind === 'Video' || o.kind === 'Audio')!.kind as 'Video' | 'Audio';
    body = <MediaBody props={props} images={images} kind={kind} />;
  } else if (images.paintings.length === 0) {
    body = <Missing images={images} />;
  } else {
    return delegate();
  }

  // ページの一覧は右パネルの「ページ一覧」タブ（panels/PagesPanel.tsx）にある
  return <>{body}</>;
}

const hasModel = (c: DisplayProps['container']) => c.painting.some((p) => p.options.some((o) => o.kind === 'Model'));

export const imageCanvasDisplay: Display = {
  id: 'image-canvas',
  // Canvas / Timeline that paint something other than a model, and a Scene without a model
  // (a Canvas the converter turned into a Scene: a Choice, a rotated image, a missing image).
  match: (c) => !hasModel(c) && (c.kind === 'Scene' || c.painting.length > 0),
  Component: ImageCanvasDisplay,
};
