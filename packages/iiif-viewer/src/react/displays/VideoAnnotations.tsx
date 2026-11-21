'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  isAnnotationAt,
  pickBodies,
  pointPercent,
  regionBoxPercent,
  type CanvasAnnotation,
  type ContainerInfo,
} from '../../core';
import { manifestAtom } from '../atoms';
import { useContentLocale } from '../env';
import { selectedCanvasAnnotationAtom } from '../overlays/canvasAnnotationState';
import { useCanvasAnnotations } from '../overlays/useCanvasAnnotations';
import { usePlayback } from '../playback';

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const STROKE = '#2563eb';
const SELECTED = '#f97316';

// Over the video, draws the frames of annotations that point to a time and a region (target "#t=5,6&xywh=...").
// A frame is shown only during that time. It is placed by fractions of the Canvas coordinates (in a box the size of the video).
// The frame itself cannot be clicked (it does not get in the way of the video controls). Clicking the name tag at the top left selects the annotation in the list of the right panel.
export default function VideoAnnotations({ container }: { container: ContainerInfo }) {
  const locale = useContentLocale();
  const manifest = useAtomValue(manifestAtom);
  const { annotations, styleOf } = useCanvasAnnotations(manifest, container);
  const [selected, setSelected] = useAtom(selectedCanvasAnnotationAtom);
  const { mediaRef, currentTime } = usePlayback();
  const width = container.width ?? 0;
  const height = container.height ?? 0;

  const placed = useMemo(
    () => annotations.filter((a) => a.region.type !== 'canvas' && !a.layer && !a.painted),
    [annotations],
  );

  // While playing, follow more finely than timeupdate (about 4 times a second). While paused, do not follow.
  // Redraw only when the set of frames to show changes.
  const [shown, setShown] = useState<string>('');
  useEffect(() => {
    if (placed.length === 0) return;
    const el = mediaRef.current;
    let frame = 0;
    const tick = () => {
      const t = el?.currentTime ?? currentTime;
      const key = placed.filter((a) => isAnnotationAt(a, t)).map((a) => a.id).join('\n');
      setShown((prev) => (prev === key ? prev : key));
      if (el && !el.paused) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [placed, mediaRef, currentTime]);

  if (placed.length === 0 || !(width > 0) || !(height > 0)) return null;
  const visible = new Set(shown ? shown.split('\n') : []);
  const drawn = placed.filter((a) => visible.has(a.id));

  const titleOf = (a: CanvasAnnotation) =>
    pickBodies(a.bodies, locale)
      .filter((b) => b.kind === 'text')
      .map((b) => (/html/i.test(b.format ?? '') ? plain(b.value ?? '') : b.value))
      .join(' / ');

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" data-overlay="video-annotations">
      {drawn.map((a) => {
        const r = a.region;
        const isSel = selected === a.id;
        const st = isSel ? {} : styleOf(a).target;
        const color = isSel ? SELECTED : (st.borderColor ?? STROKE);
        const title = titleOf(a);
        const select = () => setSelected(isSel ? null : a.id);
        const tag = title ? (
          <button
            type="button"
            onClick={select}
            className="pointer-events-auto absolute left-0 top-0 -translate-y-full max-w-[16rem] truncate px-1 text-[11px] leading-4 text-white"
            style={{ backgroundColor: color }}
            title={title}
          >
            {title}
          </button>
        ) : null;
        if (r.type === 'point') {
          const p = pointPercent(r.x, r.y, width, height);
          return (
            <div key={a.id} data-annotation-id={a.id} className="absolute" style={{ left: `${p.left}%`, top: `${p.top}%` }}>
              <span
                className="absolute block w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                style={{ backgroundColor: color }}
              />
              {tag}
            </div>
          );
        }
        const b = regionBoxPercent(r, width, height);
        if (!b) return null;
        return (
          <div
            key={a.id}
            data-annotation-id={a.id}
            className="absolute"
            style={{
              left: `${b.left}%`,
              top: `${b.top}%`,
              width: `${b.width}%`,
              height: `${b.height}%`,
              // a polygon draws its own outline; only its name tag sits on the bounding box
              ...(r.type === 'rect'
                ? { boxShadow: `inset 0 0 0 2px ${color}`, backgroundColor: isSel ? 'rgba(249,115,22,0.15)' : st.backgroundColor }
                : {}),
            }}
          >
            {r.type === 'polygon' ? (
              <svg
                className="absolute inset-0 w-full h-full overflow-visible"
                viewBox={`${r.bbox.x} ${r.bbox.y} ${r.bbox.w || 1} ${r.bbox.h || 1}`}
                preserveAspectRatio="none"
              >
                {r.rings.map((ring, i) => (
                  <polygon
                    key={i}
                    points={ring.map((pt) => pt.join(',')).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            ) : null}
            {tag}
          </div>
        );
      })}
    </div>
  );
}
