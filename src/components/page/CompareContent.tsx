'use client';

import type { NextPage } from 'next';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useLocale, useTranslations } from 'next-intl';
import {
  AuthPrompt,
  ImageCompareView,
  Info,
  SidePanel,
  manifestAtom,
  manifestUrlAtom,
  paintedModelsAtom,
  useCanvasImages,
  useCompareSources,
  useAuthStates,
  useManifest,
  type CompareBlend,
  type CompareMode,
  type SwipeDirection,
} from '@nakamura196/iiif-viewer';
import Header from '@/components/Header';
import { Link } from '@/i18n/routing';
import ManifestInput from '@/components/Input';
import ManifestParamWatcher from '@/components/ManifestParamWatcher';
import CompareView, { type CompareMode3D } from '@/components/three/CompareView';
import {
  alignmentOf,
  authorizedUrl,
  choiceSidesOf,
  containersOf,
  contentParam,
  imageChoiceOf,
  labelIn,
  parseAlignment,
  probeServiceOf,
  type Alignment,
} from '@nakamura196/iiif-viewer/core';
import { manifestFromParams } from '@nakamura196/iiif-viewer/core';

const MODES: CompareMode[] = ['side', 'swipe', 'spyglass', 'overlay'];
// overlay fades one picture into the other: images only
const MODES_3D: CompareMode3D[] = ['side', 'swipe', 'spyglass'];
const ZOOMS = [1, 2, 3];
const BLENDS: CompareBlend[] = ['normal', 'difference', 'tint'];

// A row of buttons of which one is on (the mode, the spyglass zoom).
function Segmented<T extends string | number>({
  label,
  items,
  value,
  onChange,
  text,
}: {
  label: string;
  items: T[];
  value: T;
  onChange: (v: T) => void;
  text: (v: T) => string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded overflow-hidden border border-[var(--ds-border)]">
      {items.map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`text-sm px-3 py-1 transition-colors ${
            value === v ? 'bg-blue-600 text-white' : 'text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]'
          }`}
        >
          {text(v)}
        </button>
      ))}
    </div>
  );
}

// The sources being compared, each with a button to take it away, and a field to add one more
// (a Manifest, a Collection or an info.json). `counts`: images read from each (0: could not be read).
function SourceList({
  sources,
  counts,
  ready,
  onAdd,
  onRemove,
}: {
  sources: string[];
  counts: number[];
  ready: boolean;
  onAdd: (url: string) => void;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations('Compare');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    try {
      if (!/^https?:$/.test(new URL(u).protocol)) throw new Error();
    } catch {
      setError(t('invalidUrl'));
      return;
    }
    if (sources.includes(u)) {
      setError(t('alreadyAdded'));
      return;
    }
    setError('');
    setUrl('');
    onAdd(u);
  };
  return (
    <div className="px-3 py-2 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] text-sm text-[var(--ds-fg)] space-y-2">
      <ol className="space-y-1">
        {sources.map((s, i) => (
          <li key={s} className="flex items-center gap-2 min-w-0">
            <span className="truncate min-w-0 flex-1" title={s}>
              {s}
            </span>
            <span className="shrink-0 text-xs text-[var(--ds-fg-muted)]">
              {!ready ? '…' : counts[i] ? t('imageCount', { count: counts[i] }) : t('unreadable')}
            </span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={t('removeSource')}
              title={t('removeSource')}
              className="shrink-0 px-1.5 rounded hover:bg-[var(--ds-surface-2)]"
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('addPlaceholder')}
          aria-label={t('addSource')}
          className="flex-1 min-w-[12rem] rounded border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] px-2 py-1 placeholder-[var(--ds-fg-muted)]"
        />
        <button type="submit" className="rounded px-3 py-1 bg-blue-600 text-white hover:bg-blue-700">
          {t('add')}
        </button>
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </form>
    </div>
  );
}

// Compare two candidates of a Choice: two models of the first painted Choice of a 3D Scene
// (e.g. LiDAR points and textured buildings of the same area; other painted models are drawn
// on both sides), or two images of a Canvas (e.g. a letter in ordinary and transmitted light).
// Images of different sources can be compared too: a Collection as iiif-content (its Manifests), and/or
// repeated src=<Manifest or info.json URL>. Every Canvas that paints an image is a candidate; a and b are
// then indexes of that list. Sources can be added and taken away on the page (they are kept as src= in the URL).
// A Curation gives one image per member (cut to its region). Two sources with as many images each are
// compared pair by pair (the n-th of one with the n-th of the other; the pair can be stepped through).
// align=<URL> reads an alignment file (see `parseAlignment`): B is then laid on A by the transform of the pair.
// The URL keeps what is shown: ?iiif-content=...&canvas=0&a=0&b=1&mode=swipe(&zoom=2)(&opacity=50)(&blend=tint)(&dir=v)(&src=...)(&align=...)(&aligned=0)
const CompareContent: NextPage = () => {
  const t = useTranslations('Compare');
  const locale = useLocale();
  const [manifestUrl, setManifestUrl] = useAtom(manifestUrlAtom);
  const manifest = useAtomValue(manifestAtom);
  const paintedModels = useAtomValue(paintedModelsAtom);
  const [mode, setMode] = useState<CompareMode>('side');
  const [pick, setPick] = useState<[number, number]>([0, 1]);
  const [canvas, setCanvas] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [opacity, setOpacity] = useState(50); // %
  const [srcs, setSrcs] = useState<string[]>([]);
  const [direction, setDirection] = useState<SwipeDirection>('horizontal');
  const [showSources, setShowSources] = useState(false);
  const [blend, setBlend] = useState<CompareBlend>('normal');
  const [alignUrl, setAlignUrl] = useState<string | null>(null);
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const [aligned, setAligned] = useState(true);
  // after a source is added: B becomes its first image once it is read (index of the source)
  const pendingB = useRef<number | null>(null);
  // b= was given: keep it (otherwise two sources of the same size open at their first pair)
  const pickGiven = useRef(false);

  // 開いたとき、また入口の事例のリンクで URL の資料が変わったときに読む
  const readUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const m = manifestFromParams(params);
    if (m) setManifestUrl(m);
    const mo = params.get('mode') as CompareMode | null;
    if (mo && MODES.includes(mo)) setMode(mo);
    const a = Number(params.get('a') ?? 0);
    const b = Number(params.get('b') ?? 1);
    if (Number.isInteger(a) && Number.isInteger(b)) setPick([a, b]);
    pickGiven.current = params.has('b');
    const c = Number(params.get('canvas') ?? 0);
    if (Number.isInteger(c) && c >= 0) setCanvas(c);
    const z = Number(params.get('zoom') ?? 1);
    if (ZOOMS.includes(z)) setZoom(z);
    const o = Number(params.get('opacity') ?? 50);
    if (o >= 0 && o <= 100) setOpacity(o);
    setSrcs(params.getAll('src').filter(Boolean));
    if (params.get('dir') === 'v') setDirection('vertical');
    const bl = params.get('blend') as CompareBlend | null;
    if (bl && BLENDS.includes(bl)) setBlend(bl);
    setAlignUrl(params.get('align'));
    if (params.get('aligned') === '0') setAligned(false);
  }, [setManifestUrl]);

  useEffect(() => {
    if (!alignUrl) return;
    let cancelled = false;
    fetch(alignUrl)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((json) => {
        if (!cancelled) setAlignment(parseAlignment(json));
      });
    return () => {
      cancelled = true;
    };
  }, [alignUrl]);

  const sources = useMemo(() => [...(manifestUrl ? [manifestUrl] : []), ...srcs], [manifestUrl, srcs]);
  const found = useCompareSources(sources, locale);
  // images of different sources (a Collection, or src=...); otherwise the Choice of one Canvas / Scene
  const multi = srcs.length > 0 || found.collection;

  const addSource = (url: string) => {
    pendingB.current = sources.length;
    if (manifestUrl) setSrcs((s) => [...s, url]);
    else setManifestUrl(url);
  };
  // taking away the first one (iiif-content) moves the next src= into its place
  const removeSource = (index: number) => {
    if (index === 0 && manifestUrl) {
      setManifestUrl(srcs[0] ?? null);
      setSrcs((s) => s.slice(1));
    } else {
      const i = manifestUrl ? index - 1 : index;
      setSrcs((s) => s.filter((_, j) => j !== i));
    }
    setPick([0, 1]);
  };
  useEffect(() => {
    const at = pendingB.current;
    if (at === null || !found.ready || found.counts.length <= at) return;
    pendingB.current = null;
    const first = found.counts.slice(0, at).reduce((n, c) => n + c, 0);
    if (found.counts[at] > 0) setPick((p) => [p[0], first]);
  }, [found.ready, found.counts]);

  // a Collection or a bare info.json is not what the side panel shows
  useManifest(multi ? null : manifestUrl);

  // 3D when the first Scene paints a model; otherwise the images of the chosen Canvas
  const is3D = !multi && paintedModels.length > 0;
  const containers = useMemo(() => containersOf(manifest), [manifest]);
  const canvasIndex = Math.min(canvas, Math.max(containers.length - 1, 0));
  const images = useCanvasImages(is3D || multi ? null : manifestUrl, containers[canvasIndex]?.id);
  const imageChoice = is3D || multi ? undefined : imageChoiceOf(images);
  const modes: CompareMode[] = is3D ? MODES_3D : MODES;
  const shownMode = modes.includes(mode) ? mode : 'side';

  // keep the choice in the URL so that a comparison can be shared
  useEffect(() => {
    if (!manifestUrl && srcs.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    params.delete('iiif-content');
    params.delete('manifest');
    params.delete('curation');
    if (manifestUrl) params.set('iiif-content', manifestUrl);
    params.delete('src');
    srcs.forEach((s) => params.append('src', s));
    params.set('a', String(pick[0]));
    params.set('b', String(pick[1]));
    params.set('mode', mode);
    const keep = (key: string, value: string | null) => (value === null ? params.delete(key) : params.set(key, value));
    keep('canvas', is3D || canvasIndex === 0 ? null : String(canvasIndex));
    keep('zoom', !is3D && mode === 'spyglass' && zoom !== 1 ? String(zoom) : null);
    keep('opacity', !is3D && mode === 'overlay' && blend === 'normal' ? String(opacity) : null);
    keep('dir', mode === 'swipe' && direction === 'vertical' ? 'v' : null);
    keep('blend', !is3D && mode === 'overlay' && blend !== 'normal' ? blend : null);
    keep('align', alignUrl);
    keep('aligned', alignUrl && !aligned ? '0' : null);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [manifestUrl, srcs, pick, mode, is3D, canvasIndex, zoom, opacity, direction, blend, alignUrl, aligned]);

  const main = paintedModels[0];
  const options = useMemo(
    () => (is3D ? main?.options ?? [] : imageChoice?.options ?? []),
    [is3D, main, imageChoice],
  );
  // what the A / B menus list: models or Choice candidates, or the images of the sources
  const entries = useMemo(
    () =>
      multi
        ? found.candidates.map((c, i) => ({ key: String(i), label: c.label }))
        : options.map((o) => ({ key: o.url, label: labelIn(o.label, locale) || o.url.split('/').pop() || '' })),
    [multi, found.candidates, options, locale],
  );
  const clamp = (i: number) => Math.min(Math.max(i, 0), Math.max(entries.length - 1, 0));

  // Models behind IIIF Auth 2.0 (an AuthProbeService2 on the Model) are loaded only once the probe
  // lets the user in, as in the 3D viewer: A, B, then the other painted models.
  const loaded = useMemo(() => {
    if (!is3D || !main) return [];
    const m = (i: number) => main.options[Math.min(Math.max(i, 0), main.options.length - 1)];
    return [m(pick[0]), m(pick[1]), ...paintedModels.slice(1).map((p) => p.options[0])];
  }, [is3D, main, pick, paintedModels]);
  const probes = useMemo(() => loaded.map((o) => (o ? probeServiceOf(o.body, locale) : undefined)), [loaded, locale]);
  const authStates = useAuthStates(probes, locale);
  const modelUrls = loaded.map((o, i) => (o ? authorizedUrl(o.url, authStates[i]) : null));
  const extraKey = modelUrls.slice(2).join('\n');
  const extraModels = useMemo(
    () =>
      paintedModels
        .slice(1)
        .map((m, i) => ({ url: modelUrls[i + 2], position: m.position }))
        .filter((m): m is { url: string; position: [number, number, number] } => !!m.url),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modelUrls is rebuilt each render; extraKey holds its content
    [paintedModels, extraKey],
  );
  const nameOf = (i: number) => entries[clamp(i)]?.label ?? '';

  const sides = useMemo(() => {
    if (multi) {
      const a = found.candidates[clamp(pick[0])];
      const b = found.candidates[clamp(pick[1])];
      return a && b ? ([a.side, b.side] as const) : undefined;
    }
    return images && imageChoice ? choiceSidesOf(images, imageChoice, [clamp(pick[0]), clamp(pick[1])]) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, found.candidates, images, imageChoice, pick, entries.length]);

  // back to the ordinary viewer, at the image shown as A (its own Manifest when sources are compared;
  // none for a bare info.json). The viewer counts canvas= from 1, this page from 0.
  const viewerHref = useMemo(() => {
    const [url, index] = multi
      ? [found.candidates[clamp(pick[0])]?.manifest, found.candidates[clamp(pick[0])]?.canvas ?? 0]
      : [manifestUrl, is3D ? 0 : canvasIndex];
    return url ? `/viewer?${contentParam(url)}${index > 0 ? `&canvas=${index + 1}` : ''}` : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, found.candidates, pick, manifestUrl, is3D, canvasIndex, entries.length]);

  const select = (side: 0 | 1, value: number) =>
    setPick((p) => (side === 0 ? [value, p[1]] : [p[0], value]));

  // two sources with as many images each: the n-th of one is compared with the n-th of the other
  const pairSize = multi && found.counts.length === 2 && found.counts[0] === found.counts[1] ? found.counts[0] : 0;
  const pairIndex = pairSize > 1 && clamp(pick[1]) - clamp(pick[0]) === pairSize ? clamp(pick[0]) : -1;
  useEffect(() => {
    if (pickGiven.current || pairSize < 2) return;
    pickGiven.current = true;
    setPick([0, pairSize]);
  }, [pairSize]);
  const step = (d: number) =>
    setPick((p) => {
      const n = entries.length;
      const a = clamp(p[0]) + d;
      const b = clamp(p[1]) + d;
      return a < 0 || b < 0 || a >= n || b >= n ? p : [a, b];
    });
  const pairName = (i: number) => {
    const name = entries[i]?.label ?? '';
    const cut = name.lastIndexOf(' — ');
    return cut < 0 ? String(i + 1) : name.slice(cut + 3);
  };

  // the transform of the pair shown (undefined: the file does not list it; null: it could not be aligned)
  const alignB = useMemo(() => {
    if (!multi || !alignment) return undefined;
    return alignmentOf(alignment, found.candidates[clamp(pick[0])]?.id, found.candidates[clamp(pick[1])]?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, alignment, found.candidates, pick, entries.length]);

  const selectClass =
    'text-sm rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] text-[var(--ds-fg)] px-2 py-1 max-w-[12rem]';
  const labelClass = 'flex items-center gap-1.5 text-sm text-[var(--ds-fg)]';
  const stepClass = 'text-sm px-2 py-1 rounded border border-[var(--ds-border)] text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]';

  let noChoice: string | null = null;
  if (is3D && options.length < 2) noChoice = t('noChoice');
  else if (multi && found.ready && found.candidates.length < 2) noChoice = t('noSources');
  else if (!multi && !is3D && found.ready && images && !imageChoice) noChoice = t('addAnother');
  // one source with nothing to compare in it: open the list so that another can be added
  const needMore = noChoice === t('addAnother') || (multi && found.ready && found.candidates.length < 2);
  useEffect(() => {
    if (needMore) setShowSources(true);
  }, [needMore]);

  return (
    <div className="flex flex-col h-dvh">
      <Suspense fallback={null}>
        <ManifestParamWatcher onChange={readUrl} />
      </Suspense>
      <Header compact />
      <main className="flex-1 flex overflow-hidden">
        {manifestUrl || srcs.length > 0 ? (
          <div className="flex flex-col sm:flex-row w-full">
            <div className="flex-1 min-h-0 min-w-0 flex flex-col">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 border-b border-[var(--ds-border)] bg-[var(--ds-surface)]">
                <Segmented label={t('mode')} items={modes} value={shownMode} onChange={setMode} text={(m) => t(`modes.${m}`)} />
                {shownMode === 'swipe' && (
                  <Segmented
                    label={t('swipeDirection')}
                    items={['horizontal', 'vertical'] as SwipeDirection[]}
                    value={direction}
                    onChange={setDirection}
                    text={(d) => t(`directions.${d === 'vertical' ? 'v' : 'h'}`)}
                  />
                )}
                {!is3D && !multi && containers.length > 1 && (
                  <label className={labelClass}>
                    {t('canvas')}
                    <select value={canvasIndex} onChange={(e) => setCanvas(Number(e.target.value))} className={selectClass}>
                      {containers.map((c, i) => (
                        <option key={c.id} value={i}>
                          {labelIn(c.label, locale) || String(i + 1)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {([0, 1] as const).map((side) => (
                  <label key={side} className={labelClass}>
                    {side === 0 ? 'A' : 'B'}
                    <select value={clamp(pick[side])} onChange={(e) => select(side, Number(e.target.value))} className={selectClass}>
                      {entries.map((o, i) => (
                        <option key={o.key} value={i}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {!is3D && shownMode === 'spyglass' && (
                  <span className={labelClass}>
                    {t('zoom')}
                    <Segmented label={t('zoom')} items={ZOOMS} value={zoom} onChange={setZoom} text={(z) => `×${z}`} />
                  </span>
                )}
                {multi && entries.length > 2 && (
                  <span className={labelClass}>
                    <button type="button" onClick={() => step(-1)} aria-label={t('prevPair')} title={t('prevPair')} className={stepClass}>
                      ‹
                    </button>
                    {pairIndex >= 0 ? (
                      <select
                        value={pairIndex}
                        onChange={(e) => setPick([Number(e.target.value), Number(e.target.value) + pairSize])}
                        aria-label={t('pair')}
                        className={selectClass}
                      >
                        {Array.from({ length: pairSize }, (_, i) => (
                          <option key={i} value={i}>
                            {pairName(i)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      pairSize > 1 && (
                        <button type="button" onClick={() => setPick([clamp(pick[0]) % pairSize, (clamp(pick[0]) % pairSize) + pairSize])} className={stepClass}>
                          {t('pairUp')}
                        </button>
                      )
                    )}
                    <button type="button" onClick={() => step(1)} aria-label={t('nextPair')} title={t('nextPair')} className={stepClass}>
                      ›
                    </button>
                  </span>
                )}
                {alignment && (
                  <label className={labelClass}>
                    <input type="checkbox" checked={aligned} onChange={(e) => setAligned(e.target.checked)} />
                    {t('align')}
                    {aligned && alignB === null && <span className="text-xs text-[var(--ds-fg-muted)]">{t('alignFailed')}</span>}
                    {aligned && alignB === undefined && <span className="text-xs text-[var(--ds-fg-muted)]">{t('alignNone')}</span>}
                  </label>
                )}
                {!is3D && shownMode === 'overlay' && (
                  <Segmented label={t('blend')} items={BLENDS} value={blend} onChange={setBlend} text={(b) => t(`blends.${b}`)} />
                )}
                {!is3D && shownMode === 'overlay' && blend === 'normal' && (
                  <label className={labelClass}>
                    {t('opacity')}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={opacity}
                      onChange={(e) => setOpacity(Number(e.target.value))}
                      className="w-32"
                    />
                    <span className="w-9 text-right tabular-nums">{opacity}%</span>
                  </label>
                )}
                {noChoice && <span className="text-sm font-medium text-[var(--ds-fg)]">{noChoice}</span>}
                <button
                  type="button"
                  onClick={() => setShowSources((v) => !v)}
                  aria-expanded={showSources}
                  className="ml-auto text-sm px-3 py-1 rounded border border-[var(--ds-border)] text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]"
                >
                  {t('sources', { count: sources.length })}
                </button>
                {viewerHref && (
                  <Link
                    href={viewerHref}
                    className="text-sm px-3 py-1 rounded border border-[var(--ds-border)] text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]"
                  >
                    {t('openInViewer')}
                  </Link>
                )}
              </div>
              {showSources && (
                <SourceList
                  sources={sources}
                  counts={found.counts}
                  ready={found.ready}
                  onAdd={addSource}
                  onRemove={removeSource}
                />
              )}
              <div className="relative flex-1 min-h-0">
                {is3D ? (
                  <CompareView
                    mode={shownMode === 'overlay' ? 'side' : shownMode}
                    urls={[modelUrls[0] ?? null, modelUrls[1] ?? null]}
                    labels={[nameOf(pick[0]), nameOf(pick[1])]}
                    extraModels={extraModels}
                    swipeDirection={direction}
                  />
                ) : (
                  sides && (
                    <ImageCompareView
                      sides={[sides[0], sides[1]]}
                      mode={shownMode}
                      labels={[nameOf(pick[0]), nameOf(pick[1])]}
                      zoom={zoom}
                      opacity={opacity / 100}
                      swipeHandleLabel={t('swipeHandle')}
                      spyglassHint={t('spyglassHint')}
                      swipeDirection={direction}
                      alignB={aligned ? alignB : undefined}
                      blend={blend}
                    />
                  )
                )}
                {is3D && <AuthPrompt />}
              </div>
            </div>
            {!multi && (
              <SidePanel className="bg-[var(--ds-surface)] shadow-lg overflow-y-auto border-t sm:border-t-0 sm:border-l border-[var(--ds-border)]">
                <Info />
              </SidePanel>
            )}
          </div>
        ) : (
          <div className="w-full h-full overflow-y-auto flex px-4 py-8">
            {/* 入口の画面。中身が画面より高いときは上から並べてスクロールさせ（真ん中寄せだと上が切れる）、幅はトップに近い 768px まで */}
            <div className="m-auto w-full max-w-3xl">
              <ManifestInput onSubmit={(url: string) => setManifestUrl(url)} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default CompareContent;
