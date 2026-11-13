// The containers of a manifest (Scene / Canvas / Timeline) and what each one holds:
// what is painted into it (3D models, images, video, audio) and what supplements it
// (captions, transcripts). This is the shared reading step for every kind of display.

import type { ContainerV4, ManifestV4, SceneV4 } from '../types/iiif';

export type ContainerKind = 'Scene' | 'Canvas' | 'Timeline';
export type MediaKind = 'Model' | 'Image' | 'Video' | 'Audio';

// One thing that can be shown. A plain body gives one; a Choice gives several.
export interface MediaOption {
  url: string;
  kind: MediaKind;
  format?: string;
  label?: unknown; // IIIF language map or string, as in the manifest
  width?: number;
  height?: number;
  duration?: number;
}

export interface PaintingContent {
  // the painting Annotation's id (suffixed with #body-N when it has several bodies)
  id: string;
  label: unknown;
  options: MediaOption[];
}

export interface SupplementingContent {
  id: string;
  // "closedCaptions" | "transcript" | ... (the Annotation's `provides`)
  provides: string[];
  url: string;
  format?: string;
  language: string[];
  label?: unknown;
}

export interface ContainerInfo {
  id: string;
  kind: ContainerKind;
  label: unknown;
  width?: number;
  height?: number;
  duration?: number;
  painting: PaintingContent[];
  supplementing: SupplementingContent[];
}

type Json = Record<string, unknown>;

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : undefined;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

// Presentation 3 calls audio "Sound"; Presentation 4 recipes use "Audio".
const mediaKindOf = (type: unknown): MediaKind | null => {
  switch (type) {
    case 'Model':
      return 'Model';
    case 'Image':
      return 'Image';
    case 'Video':
      return 'Video';
    case 'Audio':
    case 'Sound':
      return 'Audio';
    default:
      return null;
  }
};

const optionOf = (body: unknown): MediaOption | null => {
  const b = body as Json | undefined;
  const kind = mediaKindOf(b?.type);
  const url = str(b?.id);
  if (!b || !kind || !url) return null;
  const out: MediaOption = { url, kind, label: b.label };
  const format = str(b.format);
  if (format) out.format = format;
  for (const key of ['width', 'height', 'duration'] as const) {
    const v = num(b[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
};

const annotationsOf = (pages: unknown): Json[] =>
  asList(pages).flatMap((page) => asList((page as Json | undefined)?.items) as Json[]);

const motivationsOf = (anno: Json): unknown[] => asList(anno.motivation);

const paintingOf = (container: Json): PaintingContent[] => {
  const out: PaintingContent[] = [];
  for (const anno of annotationsOf(container.items)) {
    if (!motivationsOf(anno).includes('painting')) continue;
    const bodies = asList(anno.body);
    bodies.forEach((raw, j) => {
      const body = raw as Json | undefined;
      const isChoice = body?.type === 'Choice';
      const options = (isChoice ? asList(body.items) : [body])
        .map(optionOf)
        .filter((o): o is MediaOption => o !== null);
      if (options.length === 0) return;
      const annoId = String(anno.id ?? `painting-${out.length}`);
      out.push({
        id: bodies.length > 1 ? `${annoId}#body-${j}` : annoId,
        label: isChoice ? body.label : options[0].label,
        options,
      });
    });
  }
  return out;
};

const languagesOf = (v: unknown): string[] => asList(v).filter((l): l is string => typeof l === 'string');

// Supplementing Annotations sit in `annotations`; `items` is also read so that a
// manifest which puts them next to the painting ones is not silently dropped.
const supplementingOf = (container: Json): SupplementingContent[] => {
  const out: SupplementingContent[] = [];
  for (const anno of [...annotationsOf(container.annotations), ...annotationsOf(container.items)]) {
    if (!motivationsOf(anno).includes('supplementing')) continue;
    for (const raw of asList(anno.body)) {
      const body = raw as Json | undefined;
      const url = str(body?.id);
      if (!body || !url) continue;
      out.push({
        id: String(anno.id ?? `supplementing-${out.length}`),
        provides: asList(anno.provides).filter((p): p is string => typeof p === 'string'),
        url,
        ...(str(body.format) ? { format: str(body.format) } : {}),
        language: languagesOf(body.language),
        label: body.label,
      });
    }
  }
  return out;
};

const KINDS: readonly string[] = ['Scene', 'Canvas', 'Timeline'];

// The containers of a manifest, in order. Containers of any other type are skipped.
export const containersOf = (manifest: ManifestV4 | null | undefined): ContainerInfo[] => {
  const out: ContainerInfo[] = [];
  for (const c of manifest?.items ?? []) {
    const raw = c as unknown as Json;
    if (typeof raw?.type !== 'string' || !KINDS.includes(raw.type)) continue;
    const info: ContainerInfo = {
      id: String(raw.id ?? `container-${out.length}`),
      kind: raw.type as ContainerKind,
      label: raw.label,
      painting: paintingOf(raw),
      supplementing: supplementingOf(raw),
    };
    for (const key of ['width', 'height', 'duration'] as const) {
      const v = num(raw[key]);
      if (v !== undefined) info[key] = v;
    }
    out.push(info);
  }
  return out;
};

// The first Scene of a manifest (the one shown when none is picked).
export const firstSceneOf = (manifest: ManifestV4 | null | undefined): SceneV4 | undefined =>
  (manifest?.items ?? []).find((c): c is SceneV4 => (c as ContainerV4)?.type === 'Scene');

// The Scene with this id, or the first Scene when the id is not given (or not a Scene of the manifest).
export const sceneOf = (manifest: ManifestV4 | null | undefined, sceneId?: string | null): SceneV4 | undefined =>
  (sceneId
    ? (manifest?.items ?? []).find((c): c is SceneV4 => (c as ContainerV4)?.type === 'Scene' && c.id === sceneId)
    : undefined) ?? firstSceneOf(manifest);

// What the page list shows in place of a thumbnail: the container kind, or 'empty' for a
// container that paints nothing (e.g. a Canvas whose image is missing).
export const pagePlaceholderOf = (c: Pick<ContainerInfo, 'kind' | 'painting'>): ContainerKind | 'empty' =>
  c.painting.length === 0 ? 'empty' : c.kind;

// The kind of media a page shows, for the icon the page list draws in place of a missing thumbnail.
// It follows the first painted option (a Canvas may hold a video), falling back to the container
// kind; 'empty' for a page that paints nothing.
const MEDIA_OF_KIND: Record<ContainerKind, MediaKind> = { Scene: 'Model', Canvas: 'Image', Timeline: 'Audio' };
export const pageMediaOf = (c: Pick<ContainerInfo, 'kind' | 'painting'>): MediaKind | 'empty' =>
  c.painting.length === 0 ? 'empty' : (c.painting[0].options[0]?.kind ?? MEDIA_OF_KIND[c.kind]);

// The option a Choice of audio / video opens on: the first one the browser can play.
// An option without a format stays a candidate; when none can be played, the first one.
// `canPlay` is the browser's `canPlayType` (injected so that it can be tested).
export const defaultChoiceIndex = (
  options: readonly Pick<MediaOption, 'kind' | 'format'>[],
  canPlay: (format: string) => string,
): number => {
  if (!options.some((o) => o.kind === 'Audio' || o.kind === 'Video')) return 0;
  const i = options.findIndex(
    (o) => !o.format || (o.kind !== 'Audio' && o.kind !== 'Video') || canPlay(o.format) !== '',
  );
  return i < 0 ? 0 : i;
};
