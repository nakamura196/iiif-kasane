// Convert legacy IIIF Presentation 3 manifests with the project's custom
// 3DSelector / camPos extension into IIIF 3D TSG (Presentation 4) form.
//
// - Canvas       -> Scene
// - 3DSelector   -> PointSelector { x, y, z } or WktSelector POLYGON Z
// - target.id    -> kept, so annotations sharing a region stay grouped
// - target string-> SpecificResource { source:[Scene], selector:[...] }
// - camPos       -> separate PerspectiveCamera Annotation,
//                   id = `${annotation.id}/camera`
// - motivation   -> always an array
//
// If the input already declares Presentation 4 context, it is returned
// untouched.

import type {
  AnnotationPageV4,
  AnnotationV4,
  ContainerV4,
  ManifestV4,
  SceneV4,
  SpecificResourceV4,
} from '../types/iiif';

const V4_CONTEXT = 'http://iiif.io/api/presentation/4/context.json';

type Triple = [number, number, number];

interface LegacySelector {
  type?: string;
  // Legacy custom shape uses a number[] for a point and area; the standard
  // IIIF 3D shape uses inline x/y/z (PointSelector) or a WKT string (Polygon).
  value?: number[] | string;
  area?: number[];
  camPos?: number[];
  x?: number;
  y?: number;
  z?: number;
}

interface LegacyTargetObject {
  id?: string;
  source?: string | { id?: string; type?: string };
  selector?: LegacySelector;
}

interface LegacyAnnotation {
  id?: string;
  type?: string;
  motivation?: string | string[];
  body?: unknown;
  bodyValue?: string;
  target?: string | LegacyTargetObject;
  seeAlso?: unknown;
  [extra: string]: unknown;
}

interface LegacyAnnotationPage {
  id?: string;
  type?: string;
  items?: LegacyAnnotation[];
}

interface LegacyContainer {
  id?: string;
  type?: string;
  label?: unknown;
  items?: LegacyAnnotationPage[];
  annotations?: LegacyAnnotationPage[];
  [extra: string]: unknown;
}

const DESCRIPTIVE_KEYS = [
  'metadata',
  'summary',
  'requiredStatement',
  'rights',
  'provider',
  'homepage',
  'seeAlso',
  'rendering',
  'navDate',
  'navPlace',
  'behavior',
  'thumbnail',
] as const;

interface LegacyManifest {
  '@context'?: string | string[];
  id?: string;
  type?: string;
  items?: LegacyContainer[];
  [extra: string]: unknown;
}

const isV4 = (manifest: LegacyManifest): boolean => {
  const ctx = manifest['@context'];
  if (!ctx) return false;
  const list = Array.isArray(ctx) ? ctx : [ctx];
  return list.some((c) => typeof c === 'string' && c.includes('/presentation/4/'));
};

const asTriple = (input: unknown): Triple | null => {
  // Only a genuine numeric array is a triple. A WKT string also has a
  // `.length`, so guarding on Array.isArray avoids indexing it char-by-char
  // (which previously produced [NaN, NaN, NaN]).
  if (!Array.isArray(input) || input.length < 3) return null;
  const triple: Triple = [Number(input[0]), Number(input[1]), Number(input[2])];
  return triple.every((n) => Number.isFinite(n)) ? triple : null;
};

// A point may arrive as a legacy `value: [x, y, z]` array or as a standard
// IIIF PointSelector with inline `x` / `y` / `z` properties.
const pointFromSelector = (sel: LegacySelector): Triple | null => {
  const fromValue = asTriple(sel.value);
  if (fromValue) return fromValue;
  const { x, y, z } = sel;
  if ([x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [x as number, y as number, z as number];
  }
  return null;
};

// A polygon may arrive as a legacy `area: [x, y, z, ...]` flat array or as a
// standard WKT string (`POLYGON Z ((...))` / `POLYGONZ((...))`) in `value`.
const wktFromSelector = (sel: LegacySelector): string | null => {
  if (sel.area && sel.area.length >= 9) return buildWktPolygon(sel.area);
  if (typeof sel.value === 'string' && /POLYGON/i.test(sel.value)) return sel.value;
  return null;
};

const buildPointSelector = (xyz: Triple) => ({
  type: 'PointSelector' as const,
  x: xyz[0],
  y: xyz[1],
  z: xyz[2],
});

const buildWktPolygon = (area: number[]): string => {
  const points: string[] = [];
  for (let i = 0; i + 2 < area.length; i += 3) {
    points.push(`${area[i]} ${area[i + 1]} ${area[i + 2]}`);
  }
  return `POLYGON Z ((${points.join(', ')}))`;
};

const buildSceneSource = (sceneId: string): SpecificResourceV4['source'] => [
  { id: sceneId, type: 'Scene' },
];

const normalizeMotivation = (m: unknown): string[] => {
  if (Array.isArray(m)) return m.map(String);
  if (typeof m === 'string') return [m];
  return [];
};

const convertCommentingAnnotation = (
  anno: LegacyAnnotation,
  sceneId: string,
): { annotation: AnnotationV4; camera: AnnotationV4 | null } => {
  const target = (anno.target ?? {}) as LegacyTargetObject;
  const selector: LegacySelector = (typeof target === 'object' && target.selector) || {};
  const wkt = wktFromSelector(selector);
  const value = pointFromSelector(selector);
  const camPos = asTriple(selector.camPos);

  const v4Selector = wkt
    ? { type: 'WktSelector' as const, value: wkt }
    : value
      ? buildPointSelector(value)
      : null;

  const annotationId = anno.id ?? `${sceneId}/anno/${Math.random().toString(36).slice(2, 10)}`;

  const v4Target: SpecificResourceV4 = {
    ...(typeof target === 'object' && typeof target.id === 'string' ? { id: target.id } : {}),
    type: 'SpecificResource',
    source: buildSceneSource(sceneId),
    ...(v4Selector ? { selector: [v4Selector] } : {}),
  };

  const motivation = normalizeMotivation(anno.motivation);

  const annotation: AnnotationV4 = {
    id: annotationId,
    type: 'Annotation',
    motivation: motivation.length > 0 ? motivation : ['commenting'],
    target: v4Target,
    ...(anno.label !== undefined ? { label: anno.label as AnnotationV4['label'] } : {}),
    ...(anno.body !== undefined ? { body: anno.body as AnnotationV4['body'] } : {}),
    ...(anno.bodyValue !== undefined ? { bodyValue: anno.bodyValue } : {}),
    ...(anno.creator !== undefined ? { creator: anno.creator as AnnotationV4['creator'] } : {}),
    ...(typeof anno.created === 'string' ? { created: anno.created } : {}),
    ...(anno.seeAlso !== undefined
      ? { seeAlso: anno.seeAlso as AnnotationV4['seeAlso'] }
      : {}),
    ...(camPos ? { cameraAnnotation: `${annotationId}/camera` } : {}),
  };

  if (!camPos) {
    return { annotation, camera: null };
  }

  const camera: AnnotationV4 = {
    id: `${annotationId}/camera`,
    type: 'Annotation',
    motivation: ['painting'],
    body: {
      type: 'SpecificResource',
      source: [
        {
          type: 'PerspectiveCamera',
        },
      ],
    },
    target: {
      type: 'SpecificResource',
      source: buildSceneSource(sceneId),
      selector: [buildPointSelector(camPos)],
    },
  };

  return { annotation, camera };
};

const convertModelAnnotation = (
  anno: LegacyAnnotation,
  sceneId: string,
): AnnotationV4 => {
  const motivation = normalizeMotivation(anno.motivation);
  return {
    id: anno.id ?? `${sceneId}/model`,
    type: 'Annotation',
    motivation: motivation.length > 0 ? motivation : ['painting'],
    body: anno.body as AnnotationV4['body'],
    target: {
      type: 'SpecificResource',
      source: buildSceneSource(sceneId),
      selector: [buildPointSelector([0, 0, 0])],
    },
  };
};

const passthroughGeoreferencing = (
  anno: LegacyAnnotation,
  sceneId: string,
): AnnotationV4 => ({
  id: anno.id ?? `${sceneId}/georef`,
  type: 'Annotation',
  motivation: ['georeferencing'],
  body: anno.body as AnnotationV4['body'],
  target: {
    type: 'SpecificResource',
    source: buildSceneSource(sceneId),
  },
});

const convertCanvasToScene = (canvas: LegacyContainer): SceneV4 => {
  const sceneId = canvas.id ?? 'urn:scene';

  const itemsPages: AnnotationPageV4[] = (canvas.items ?? []).map((page, pageIndex) => {
    const v4Items: AnnotationV4[] = [];
    for (const anno of page.items ?? []) {
      const motivation = normalizeMotivation(anno.motivation);
      if (motivation.includes('painting')) {
        v4Items.push(convertModelAnnotation(anno, sceneId));
      } else {
        // Unknown motivation in items[] is rare; fall back to commenting handling.
        const { annotation } = convertCommentingAnnotation(anno, sceneId);
        v4Items.push(annotation);
      }
    }
    return {
      id: page.id ?? `${sceneId}/page/items/${pageIndex}`,
      type: 'AnnotationPage',
      items: v4Items,
    };
  });

  const annotationsPages: AnnotationPageV4[] = [];
  const cameraAnnotations: AnnotationV4[] = [];
  for (const [pageIndex, page] of (canvas.annotations ?? []).entries()) {
    const v4Items: AnnotationV4[] = [];
    for (const anno of page.items ?? []) {
      const motivation = normalizeMotivation(anno.motivation);
      if (motivation.includes('georeferencing')) {
        v4Items.push(passthroughGeoreferencing(anno, sceneId));
        continue;
      }
      const { annotation, camera } = convertCommentingAnnotation(anno, sceneId);
      v4Items.push(annotation);
      if (camera) cameraAnnotations.push(camera);
    }
    annotationsPages.push({
      id: page.id ?? `${sceneId}/page/annotations/${pageIndex}`,
      type: 'AnnotationPage',
      items: v4Items,
    });
  }

  if (cameraAnnotations.length > 0) {
    annotationsPages.push({
      id: `${sceneId}/page/cameras`,
      type: 'AnnotationPage',
      items: cameraAnnotations,
    });
  }

  // Canvas の説明用の項目（メタデータ・要約・権利・提供者・日時・場所など）を Scene にも残す
  const descriptive: Record<string, unknown> = {};
  for (const key of DESCRIPTIVE_KEYS) {
    if (canvas[key] !== undefined) descriptive[key] = canvas[key];
  }

  return {
    id: sceneId,
    type: 'Scene',
    ...(descriptive as Partial<SceneV4>),
    ...(canvas.label !== undefined ? { label: canvas.label as SceneV4['label'] } : {}),
    items: itemsPages,
    annotations: annotationsPages,
  };
};

// Body types of media that are not 3D. A legacy Canvas that paints one of these (and no
// Model) is a plain image / video / audio page, not a Scene.
const FLAT_MEDIA = new Set(['Image', 'Video', 'Audio', 'Sound']);

const paintsOnlyFlatMedia = (canvas: LegacyContainer): boolean => {
  const types: unknown[] = [];
  for (const page of canvas.items ?? []) {
    for (const anno of page.items ?? []) {
      if (!normalizeMotivation(anno.motivation).includes('painting')) continue;
      // A Choice (alternative formats of one thing) is judged by what it offers.
      const bodies = [anno.body].flat().flatMap((b) => {
        const body = b as { type?: unknown; items?: unknown } | undefined;
        return body?.type === 'Choice' && Array.isArray(body.items) ? body.items : [b];
      });
      types.push(...bodies.map((b) => (b as { type?: unknown } | undefined)?.type));
    }
  }
  return types.some((t) => FLAT_MEDIA.has(t as string)) && !types.includes('Model');
};

// Canvas -> Scene, except a Canvas / Timeline that holds only flat media, which is kept
// as it is. Everything else (including an empty Canvas) stays a Scene, as before.
const convertContainer = (c: LegacyContainer): SceneV4 | ContainerV4 =>
  c.type === 'Timeline' || (c.type === 'Canvas' && paintsOnlyFlatMedia(c))
    ? (c as unknown as ContainerV4)
    : convertCanvasToScene(c);

export const convertToV4 = (manifest: unknown): ManifestV4 => {
  const m = (manifest ?? {}) as LegacyManifest;

  if (isV4(m)) {
    return m as unknown as ManifestV4;
  }

  const scenes: ContainerV4[] = (m.items ?? []).map(convertContainer);

  const next: Record<string, unknown> = { ...m };
  next['@context'] = V4_CONTEXT;
  next.items = scenes;

  return next as unknown as ManifestV4;
};
