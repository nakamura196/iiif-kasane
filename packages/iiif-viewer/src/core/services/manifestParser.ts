// Read a v4 IIIF Manifest and project it into the viewer's internal
// Annotation / GeoFeature shapes. Input is expected to already be v4
// (use convertToV4 first if the source is the legacy format).

import type {
  AnnotationLinkV4,
  CanvasV4,
  AnnotationPageV4,
  AnnotationV4,
  ManifestV4,
  PointSelectorV4,
  SceneV4,
  SelectorV4,
  SpecificResourceV4,
  WKTSelectorV4,
} from '../types/iiif';
import type { Annotation, AnnotationImage, AnnotationTag } from '../types/main';
import { sceneOf } from './containers';
import { labelIn, paintedModelsOf } from './paintedModels';

export interface GeoFeatureName {
  toponym: string;
  lang: string;
  citations?: { label: string; '@id': string }[];
}

export interface GeoFeatureLink {
  type: string;
  identifier: string;
}

export interface GeoFeatureDepiction {
  '@id': string;
}

export interface GeoFeature {
  '@id': string;
  /** GeoJSON の id（`@id` が無い地物で使う）。 */
  id?: string;
  type: 'Feature';
  geometry: { coordinates: [number, number]; type: 'Point' };
  /** resourceCoords: 3D の模型なら [x, y, z]、画像なら Canvas 座標の [x, y]。 */
  properties: {
    title: string;
    resourceCoords: [number, number] | [number, number, number];
    tags?: string[];
    /** geo.ldas.jp の古い形式。links が無いときの「詳細」のリンク。 */
    url?: string;
    /** 画像上の範囲（Canvas 座標の "x,y,w,h"）。geo.ldas.jp は四角で描く。 */
    xywh?: string;
  };
  /** geo.ldas.jp の古い形式。タグや範囲を properties ではなくここに書いていた。 */
  metadata?: { tags?: string[]; xywh?: string };
  /** geo.ldas.jp のさらに古い形式（範囲を地物の直下に書く）。 */
  xywh?: string;
  names?: GeoFeatureName[];
  links?: GeoFeatureLink[];
  depictions?: GeoFeatureDepiction[];
}

export interface ParsedManifest {
  modelUrl: string | null;
  /** The Model body behind modelUrl, so a page can read its IIIF Auth 2.0 probe service. */
  modelBody?: unknown;
  annotations: Annotation[];
  geoFeatures: GeoFeature[];
  /** 地点が画像（Canvas）に付いているとき、その Canvas の id。3D の Scene に付いているときは無い。 */
  geoCanvasId?: string;
}

const ZERO: [number, number, number] = [0, 0, 0];

const motivationsOf = (anno: AnnotationV4): string[] => {
  const m = anno.motivation;
  if (Array.isArray(m)) return m;
  if (typeof m === 'string') return [m];
  return [];
};

const isPointSelector = (s: SelectorV4): s is PointSelectorV4 =>
  s?.type === 'PointSelector';

const isWktSelector = (s: SelectorV4): s is WKTSelectorV4 =>
  s?.type === 'WktSelector' || s?.type === 'WKTSelector';

const targetSelectors = (anno: AnnotationV4): SelectorV4[] => {
  const t = anno.target as SpecificResourceV4 | undefined;
  if (!t || typeof t !== 'object') return [];
  return Array.isArray(t.selector) ? t.selector : [];
};

const parseWktPolygonZ = (wkt: string): number[] => {
  // POLYGON Z ((x y z, x y z, ...))  — only the first ring is consumed.
  const open = wkt.indexOf('((');
  const close = wkt.indexOf('))', open);
  if (open < 0 || close < 0) return [];
  const ring = wkt.slice(open + 2, close);
  const out: number[] = [];
  for (const raw of ring.split(',')) {
    const [x, y, z] = raw.trim().split(/\s+/).map(Number);
    if ([x, y, z].every((n) => Number.isFinite(n))) out.push(x, y, z);
  }
  return out;
};

const polygonCentroid = (flat: number[]): [number, number, number] => {
  if (flat.length < 3) return [...ZERO];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (let i = 0; i + 2 < flat.length; i += 3) {
    sx += flat[i];
    sy += flat[i + 1];
    sz += flat[i + 2];
    n++;
  }
  return n === 0 ? [...ZERO] : [sx / n, sy / n, sz / n];
};

const flattenAllPages = (pages: AnnotationPageV4[] | undefined): AnnotationV4[] => {
  if (!pages) return [];
  const out: AnnotationV4[] = [];
  for (const page of pages) {
    for (const anno of page.items ?? []) out.push(anno);
  }
  return out;
};

interface CameraView {
  position: [number, number, number];
  lookAt: [number, number, number] | null;
}

const pointOf = (sel: unknown): [number, number, number] | null => {
  const s = sel as { type?: string; x?: unknown; y?: unknown; z?: unknown } | undefined;
  if (s?.type !== 'PointSelector') return null;
  const v = [s.x ?? 0, s.y ?? 0, s.z ?? 0].map(Number);
  return v.every(Number.isFinite) ? (v as [number, number, number]) : null;
};

// The Camera body of a painting Annotation: Presentation 4.0 puts the Camera itself
// in the body (body.type PerspectiveCamera); this viewer's own exporter wraps it in a
// SpecificResource (body.source[].type PerspectiveCamera). Both are read.
const cameraBodyOf = (anno: AnnotationV4): Record<string, unknown> | null => {
  if (!motivationsOf(anno).includes('painting')) return null;
  const raw = anno.body as unknown;
  const body = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') return null;
  if (typeof body.type === 'string' && /Camera$/.test(body.type)) return body;
  const source = body.source as Array<{ type?: string }> | undefined;
  return Array.isArray(source) && source.some((s) => s?.type === 'PerspectiveCamera') ? body : null;
};

// Where a Camera looks: `lookAt` is an embedded PointSelector, or a reference to an
// Annotation that targets a point.
const lookAtOf = (body: Record<string, unknown>, annos: AnnotationV4[]): [number, number, number] | null => {
  const direct = pointOf(body.lookAt);
  if (direct) return direct;
  const ref = (body.lookAt as { id?: string } | undefined)?.id;
  const target = ref ? annos.find((a) => a.id === ref) : undefined;
  return target ? targetSelectors(target).map(pointOf).find(Boolean) ?? null : null;
};

// Camera Annotations by id, from both Scene.items (where Presentation 4.0 paints
// Cameras) and Scene.annotations (where this viewer's exporter puts them).
const cameraIndex = (annos: AnnotationV4[]): Map<string, CameraView> => {
  const map = new Map<string, CameraView>();
  for (const anno of annos) {
    const body = cameraBodyOf(anno);
    if (!body) continue;
    const position = targetSelectors(anno).map(pointOf).find(Boolean);
    if (!position) continue;
    map.set(anno.id, { position, lookAt: lookAtOf(body, annos) });
  }
  return map;
};

// The Camera to view an Annotation with: the first of its `scope` that is a Camera,
// then `cameraAnnotation`, then the `<id>/camera` naming convention.
const cameraFor = (anno: AnnotationV4, cameras: Map<string, CameraView>): CameraView | undefined => {
  const scope = [anno.scope ?? []].flat().map((s) => (typeof s === 'string' ? s : s?.id));
  for (const id of [...scope, anno.cameraAnnotation, `${anno.id}/camera`]) {
    const camera = id ? cameras.get(id) : undefined;
    if (camera) return camera;
  }
  return undefined;
};

// The model shown when only one is used: the first painted Model (for a Choice,
// its first item — the default).
const extractModel = (scene: SceneV4 | undefined): { url: string | null; body?: unknown } => {
  const option = paintedModelsOf(scene)[0]?.options[0];
  return { url: option?.url ?? null, body: option?.body };
};

// A place name may be a IIIF language map instead of a string: pick the reader's language.
const withTitleIn = (feature: GeoFeature, locale: string): GeoFeature => {
  const title: unknown = feature.properties?.title;
  return title === undefined || typeof title === 'string'
    ? feature
    : { ...feature, properties: { ...feature.properties, title: labelIn(title, locale) } };
};

const extractGeoFeatures = (annos: AnnotationV4[], locale: string): GeoFeature[] => {
  const out: GeoFeature[] = [];
  for (const anno of annos) {
    if (!motivationsOf(anno).includes('georeferencing')) continue;
    const body = anno.body as { type?: string; features?: GeoFeature[] } | undefined;
    if (body?.type === 'FeatureCollection' && Array.isArray(body.features)) {
      out.push(...body.features.map((f) => withTitleIn(f, locale)));
    }
  }
  return out;
};

// A label may be a plain string or a IIIF language map: the reader's locale first.
const localizedString = (label: unknown, locale: string): string =>
  Array.isArray(label) ? label.map(String).join(' ') : labelIn(label, locale);

const hasPurpose = (body: Record<string, unknown>, purpose: string): boolean => {
  const p = body.purpose;
  return Array.isArray(p) ? p.includes(purpose) : p === purpose;
};

const firstOf = (v: unknown): Record<string, unknown> | undefined => {
  const item = Array.isArray(v) ? v[0] : v;
  return item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined;
};

// An Image body (§5 Images in an annotation, Region & Tag extension draft).
const parseImage = (body: Record<string, unknown>, locale: string): AnnotationImage | null => {
  if (typeof body.id !== 'string') return null;
  const service = firstOf(body.service);
  const homepage = firstOf(body.homepage);
  const serviceId = service?.id ?? service?.['@id'];
  return {
    id: body.id,
    ...(body.label ? { label: localizedString(body.label, locale) } : {}),
    ...(typeof body.format === 'string' ? { format: body.format } : {}),
    ...(hasPurpose(body, 'linking') ? { purpose: 'linking' } : hasPurpose(body, 'describing') ? { purpose: 'describing' } : {}),
    ...(typeof serviceId === 'string' ? { service: serviceId.replace(/\/info\.json$/, '') } : {}),
    ...(typeof homepage?.id === 'string' ? { homepage: homepage.id } : {}),
    ...(homepage?.label ? { homepageLabel: localizedString(homepage.label, locale) } : {}),
  };
};

// The first non-tagging, non-Image body is the description. Tagging bodies become tags,
// with the body's label as the tag's key (Keyed Tag extension). Image bodies are
// pictures of the annotated place.
const parseBodies = (
  anno: AnnotationV4,
  locale: string,
): { value: string; label: string; tags: AnnotationTag[]; images: AnnotationImage[] } => {
  if (typeof anno.bodyValue === 'string') {
    return { value: anno.bodyValue, label: anno.bodyValue, tags: [], images: [] };
  }
  const raw = anno.body;
  const bodies = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  const tags: AnnotationTag[] = [];
  const images: AnnotationImage[] = [];
  let main: Record<string, unknown> | undefined;
  for (const body of bodies) {
    if (!body || typeof body !== 'object') continue;
    if (hasPurpose(body, 'tagging')) {
      if (typeof body.value !== 'string' || body.value === '') continue;
      const key = localizedString(body.label, locale);
      tags.push(key ? { key, value: body.value } : { value: body.value });
    } else if (body.type === 'Image') {
      const image = parseImage(body, locale);
      if (image) images.push(image);
    } else if (!main) {
      main = body;
    }
  }
  const value = typeof main?.value === 'string' ? main.value : '';
  const label = localizedString(main?.label, locale);
  return { value, label, tags, images };
};

const creatorName = (creator: AnnotationV4['creator']): string => {
  const list = Array.isArray(creator) ? creator : creator ? [creator] : [];
  return list
    .map((c) => (typeof c === 'string' ? c : c.name ?? c.nickname ?? c.id ?? ''))
    .filter(Boolean)
    .join(', ');
};

const buildAnnotation = (
  anno: AnnotationV4,
  cameras: Map<string, CameraView>,
  fallbackIndex: number,
  locale: string,
): Annotation | null => {
  const selectors = targetSelectors(anno);
  if (selectors.length === 0) return null;

  const point = selectors.find(isPointSelector);
  const polygon = selectors.find(isWktSelector);

  let position: [number, number, number] = [...ZERO];
  let area: [number, number, number] = [...ZERO];
  let selectorType: 'PointSelector' | 'WKTSelector' = 'PointSelector';

  if (polygon) {
    const flat = parseWktPolygonZ(polygon.value);
    selectorType = 'WKTSelector';
    position = polygonCentroid(flat);
    area = flat as unknown as [number, number, number];
  } else if (point) {
    selectorType = 'PointSelector';
    position = [point.x, point.y, point.z];
  } else {
    return null;
  }

  const camera = cameraFor(anno, cameras);
  const camPos = camera?.position ?? ([...position] as [number, number, number]);
  const camLookAt = camera?.lookAt ?? undefined;

  // Outward normal of the annotated feature (non-standard PointSelector field),
  // used to frame the feature head-on when there is no explicit camera.
  const normal = point && Array.isArray(point.normal) && point.normal.length >= 3
    ? ([point.normal[0], point.normal[1], point.normal[2]] as [number, number, number])
    : undefined;

  const bodies = parseBodies(anno, locale);
  const { value, tags, images } = bodies;
  // The Annotation's own label is the heading; a body label is the older convention.
  const label = localizedString(anno.label, locale) || bodies.label;
  const regionId = typeof anno.target === 'object' ? anno.target.id : undefined;

  return {
    id: anno.id || `annotation-${fallbackIndex}`,
    creator: creatorName(anno.creator),
    title: label,
    description: value,
    media: [],
    wikidata: [],
    bibliography: [],
    position: { x: position[0], y: position[1], z: position[2] },
    seeAlso: anno.seeAlso as AnnotationLinkV4[] | undefined,
    ...(regionId ? { regionId } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(anno.created ? { created: anno.created } : {}),
    data: {
      body: { value, label },
      target: {
        selector: {
          type: selectorType,
          value: position,
          area,
          camPos,
          ...(camLookAt ? { camLookAt } : {}),
          ...(normal ? { normal } : {}),
        },
      },
    },
  };
};

/** A Canvas that carries georeferenced places (a map or a picture). */
export interface GeoCanvas {
  id: string;
  /** The Canvas label as the JSON gives it (a language map or a string). */
  label?: unknown;
  features: GeoFeature[];
}

// Every Canvas that carries a georeferencing Annotation, in the Manifest's order.
// geo.ldas.jp shows one at a time and pages through them.
export const geoCanvasesOf = (manifest: ManifestV4, locale = 'ja'): GeoCanvas[] =>
  (manifest.items ?? []).flatMap((c) => {
    if ((c as { type?: string })?.type !== 'Canvas') return [];
    const canvas = c as CanvasV4;
    const features = extractGeoFeatures(flattenAllPages(canvas.annotations), locale);
    return features.length > 0 ? [{ id: canvas.id, label: (canvas as { label?: unknown }).label, features }] : [];
  });

// Reads the Scene `sceneId` (default: the first Scene). A Manifest without a Scene gives the
// places of its first georeferenced Canvas (geoCanvasId) instead.
/** `locale` picks the language of the labels (default: Japanese). */
export const parseManifestV4 = (manifest: ManifestV4, sceneId?: string | null, locale = 'ja'): ParsedManifest => {
  const scene = sceneOf(manifest, sceneId);
  if (!scene) {
    const canvas = geoCanvasesOf(manifest, locale)[0];
    if (canvas) {
      return { modelUrl: null, annotations: [], geoFeatures: canvas.features, geoCanvasId: canvas.id };
    }
  }
  const { url: modelUrl, body: modelBody } = extractModel(scene);

  const sceneAnnotations = flattenAllPages(scene?.annotations);
  const cameras = cameraIndex([...flattenAllPages(scene?.items), ...sceneAnnotations]);
  const geoFeatures = extractGeoFeatures(sceneAnnotations, locale);

  const out: Annotation[] = [];
  let i = 0;
  for (const anno of sceneAnnotations) {
    const motivations = motivationsOf(anno);
    if (motivations.includes('georeferencing')) continue;
    // Skip camera annotations themselves; they only feed `cameras`.
    if (cameras.has(anno.id)) continue;
    const built = buildAnnotation(anno, cameras, i, locale);
    if (built) out.push(built);
    i++;
  }

  return { modelUrl, modelBody, annotations: out, geoFeatures };
};

// The id the map, the list and the picture select a feature by.
export const geoFeatureIdOf = (feature: GeoFeature, idx: number): string =>
  feature['@id'] || feature.id || `geo-feature-${idx}`;

// The tags of a feature: properties.tags, or metadata.tags (geo.ldas.jp's older form).
export const geoFeatureTagsOf = (feature: GeoFeature): string[] =>
  (feature.properties.tags ?? feature.metadata?.tags ?? []).filter((t): t is string => typeof t === 'string' && t !== '');

/** 地点のリンク。type は Linked Places の関係（primaryTopicOf など）。properties.url から作ったものは 'detail'。 */
export interface GeoFeatureLinkView {
  type: string;
  href: string;
}

// http(s) のリンクだけ通す（javascript: などをポップアップの href に入れない）
const httpUrl = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};

// The links of a feature: links (Linked Places), or properties.url (geo.ldas.jp's older form) as 'detail'.
export const geoFeatureLinksOf = (feature: GeoFeature): GeoFeatureLinkView[] => {
  const links = (Array.isArray(feature.links) ? feature.links : []).flatMap((link) => {
    const href = httpUrl(link?.identifier);
    return href ? [{ type: typeof link.type === 'string' && link.type ? link.type : 'detail', href }] : [];
  });
  if (links.length > 0) return links;
  const url = httpUrl(feature.properties.url);
  return url ? [{ type: 'detail', href: url }] : [];
};

export interface GeoFeatureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The box of a feature on the picture (Canvas coordinates): properties.xywh, metadata.xywh,
// or xywh on the feature itself (geo.ldas.jp's older forms). A "pixel:" prefix (as in a media
// fragment) is allowed; "percent:" and anything that does not give 4 numbers with a positive
// width and height are not boxes.
export const geoFeatureBoxOf = (feature: GeoFeature): GeoFeatureBox | null => {
  const raw = feature.properties.xywh ?? feature.metadata?.xywh ?? feature.xywh;
  if (typeof raw !== 'string') return null;
  const body = raw.trim().replace(/^xywh=/, '').replace(/^pixel:/, '');
  const nums = body.split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = nums;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};

export const geoFeaturesToAnnotations = (features: GeoFeature[]): Annotation[] =>
  features.map((feature, idx) => {
    const [x, y, z = 0] = feature.properties.resourceCoords;
    const tags = geoFeatureTagsOf(feature);
    const coords: [number, number, number] = [x, y, z];
    return {
      id: geoFeatureIdOf(feature, idx),
      creator: '',
      title: feature.properties.title,
      description: '',
      media: [],
      wikidata: [],
      bibliography: [],
      ...(tags.length > 0 ? { tags: tags.map((value) => ({ value })) } : {}),
      position: { x: coords[0], y: coords[1], z: coords[2] },
      data: {
        body: { value: '', label: feature.properties.title },
        target: {
          selector: {
            type: 'PointSelector',
            value: coords,
            area: [...ZERO],
            camPos: [coords[0] * 1.5, coords[1] * 1.5, coords[2] * 1.5],
          },
        },
      },
    };
  });

export interface DefaultCamera {
  position: [number, number, number];
  // null: look at the model (the client decides)
  lookAt: [number, number, number] | null;
  fieldOfView?: number;
}

export interface SceneCamera extends DefaultCamera {
  id: string;
  label: unknown; // IIIF language map or string, as in the manifest
}

// The Cameras painted into the Scene `sceneId` (default: the first Scene) (painting Annotations in Scene.items) without
// the `hidden` behavior, in order (Presentation 4.0, Cameras). Position from the target's
// PointSelector, direction from `lookAt` (an embedded PointSelector, or a reference to an
// Annotation that targets a point). Hidden Cameras are the ones notes link to by `scope`.
export const sceneCamerasOf = (manifest: ManifestV4 | null | undefined, sceneId?: string | null): SceneCamera[] =>
  sceneCamerasInScene(sceneOf(manifest, sceneId));

export const sceneCamerasInScene = (scene: SceneV4 | undefined): SceneCamera[] => {
  const annos = (scene?.items ?? []).flatMap((page) => page.items ?? []);
  const all = [...annos, ...flattenAllPages(scene?.annotations)];
  const out: SceneCamera[] = [];
  for (const anno of annos) {
    const body = cameraBodyOf(anno);
    if (typeof body?.type !== 'string' || !/Camera$/.test(body.type)) continue;
    const behavior = [(anno as { behavior?: unknown }).behavior, body.behavior].flat().filter(Boolean) as string[];
    if (behavior.includes('hidden')) continue;
    const position = targetSelectors(anno).map(pointOf).find(Boolean) ?? [0, 0, 0];
    const fov = Number(body.fieldOfView);
    out.push({
      id: anno.id,
      label: (anno as { label?: unknown }).label ?? body.label ?? '',
      position,
      lookAt: lookAtOf(body, all),
      ...(Number.isFinite(fov) && fov > 0 ? { fieldOfView: fov } : {}),
    });
  }
  return out;
};

// The default Camera of the Scene `sceneId` (default: the first Scene): the first Camera painted into it.
export const defaultCameraOf = (
  manifest: ManifestV4 | null | undefined,
  sceneId?: string | null,
): DefaultCamera | null => {
  const first = sceneCamerasOf(manifest, sceneId)[0];
  if (!first) return null;
  const { position, lookAt, fieldOfView } = first;
  return { position, lookAt, ...(fieldOfView ? { fieldOfView } : {}) };
};

// The commenting Annotation that describes a georeferenced feature: the one whose id
// is the feature's @id, or ends with "#<@id>" / "/<@id>" (as in the sample manifests,
// where both are minted from the same key), or is the @id without a trailing "/gcp"
// (a control point minted from the annotation's id, as in hongo-campus-iiif).
const describes = (anno: Annotation, featureId: string) =>
  anno.id === featureId || anno.id.endsWith(`#${featureId}`) || anno.id.endsWith(`/${featureId}`) ||
  (featureId.endsWith('/gcp') && anno.id === featureId.slice(0, -'/gcp'.length));

// Annotations for the georeferencing page: one per feature, keyed by the feature's id
// (the map selects by it). A feature takes the description, images, tags and camera of
// its commenting Annotation when there is one; otherwise it is built from the feature
// alone (geoFeaturesToAnnotations). Depictions become images.
export const geoAnnotations = (features: GeoFeature[], annotations: Annotation[]): Annotation[] => {
  const plain = geoFeaturesToAnnotations(features);
  return features.map((feature, idx) => {
    const id = plain[idx].id;
    const match = annotations.find((a) => describes(a, id));
    // 説明の注釈にタグが無ければ、地物のタグを使う
    const base = match ? { ...match, id, tags: match.tags?.length ? match.tags : plain[idx].tags } : plain[idx];
    const depictions = (feature.depictions ?? []).filter((d) => typeof d['@id'] === 'string');
    return !base.images?.length && depictions.length > 0
      ? { ...base, images: depictions.map((d) => ({ id: d['@id'] })) }
      : base;
  });
};

// The map and the image marks name a place by feature.properties.title, which is one fixed
// string. A place with a commenting Annotation is named in the list by that Annotation's label
// (already in the reader's language), so take the same name for the map: tags, popups, image marks.
export const geoFeaturesNamedBy = (features: GeoFeature[], annotations: Annotation[]): GeoFeature[] =>
  features.map((feature, idx) => {
    const title = annotations[idx]?.title;
    return title && title !== feature.properties.title
      ? { ...feature, properties: { ...feature.properties, title } }
      : feature;
  });
