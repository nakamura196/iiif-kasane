// マニフェストエディタ（/manifest-editor）の組み立て。React に依存しない。
// 手元の画像から、ほかの場所でも使えるマニフェスト（Presentation 3）を作る。
// 画像は blob: のままでは他所で読めないので、利用者が「画像を置く場所の URL」を入力し、
// 画像の URL はその頭にファイル名をつないで作る。大きさは手元で画像を開いて測った値を使う。

type Json = Record<string, unknown>;

/** Where the images will be served from. */
export type ImageHosting = 'files' | 'iiif3' | 'iiif2';

export type LabelLanguage = 'ja' | 'en' | 'none';

export interface EditorPage {
  /** Stable key for the list (the image digest). */
  key: string;
  /** Canvas label. */
  label: string;
  /** Name of the image at the place it will be served from (file name, or Image API identifier). */
  path: string;
  width: number;
  height: number;
  format: string;
  /** blob: URL of the local image, used only for the preview. */
  previewUrl: string;
}

export interface EditorSettings {
  hosting: ImageHosting;
  /** URL the image names are appended to (a folder for files, the Image API base for IIIF). */
  imageBase: string;
  /** URL the manifest itself will be published at. Empty: derived from imageBase (files only). */
  manifestId: string;
  label: string;
  language: LabelLanguage;
  summary: string;
  /** rights: a license or rights statement URI. */
  rights: string;
  /** requiredStatement (attribution) text. */
  attribution: string;
  viewingDirection: 'left-to-right' | 'right-to-left';
  /** behavior: paged (show as a book, two pages side by side). */
  paged: boolean;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  hosting: 'files',
  imageBase: '',
  manifestId: '',
  label: '',
  language: 'none',
  summary: '',
  rights: '',
  attribution: '',
  viewingDirection: 'left-to-right',
  paged: false,
};

/** Common rights URIs offered in the form (any other http(s) URI can be typed). */
export const RIGHTS_CHOICES = [
  'http://creativecommons.org/publicdomain/zero/1.0/',
  'http://creativecommons.org/publicdomain/mark/1.0/',
  'http://creativecommons.org/licenses/by/4.0/',
  'http://creativecommons.org/licenses/by-sa/4.0/',
  'http://creativecommons.org/licenses/by-nc/4.0/',
  'http://creativecommons.org/licenses/by-nc-sa/4.0/',
  'http://creativecommons.org/licenses/by-nd/4.0/',
  'http://rightsstatements.org/vocab/InC/1.0/',
  'http://rightsstatements.org/vocab/NoC-US/1.0/',
  'http://rightsstatements.org/vocab/CNE/1.0/',
];

export const isHttpUrl = (s: string): boolean => {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const withSlash = (s: string): string => (s.endsWith('/') ? s : `${s}/`);
const withoutSlash = (s: string): string => s.replace(/\/+$/, '');

/**
 * Name of an image at the place it will be served from: its path inside the picked folder,
 * without the folder itself (the folder is what gets uploaded as it is).
 */
export const serverPathOf = (path: string): string => {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : parts[0] ?? '';
};

/** File name without its extension, as the default page label. */
export const pageLabelOf = (name: string): string => name.replace(/\.[^./]+$/, '') || name;

/** Image API identifier: the whole path in one URL segment (slashes escaped, as the Image API asks). */
const identifierOf = (path: string): string => encodeURIComponent(path);

/** Each folder / file name escaped, slashes kept. */
const filePathOf = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/** URL of the image service for a page (IIIF only). */
export const serviceIdOf = (settings: EditorSettings, path: string): string =>
  withoutSlash(settings.imageBase.trim()) + '/' + identifierOf(path);

/** URL the image itself will be fetched from. */
export const imageUrlOf = (settings: EditorSettings, path: string): string => {
  const base = settings.imageBase.trim();
  if (settings.hosting === 'files') return withSlash(base) + filePathOf(path);
  // 2.x の「full」は 3.0 で「max」に替わった。2.x のサーバには full で頼む
  const size = settings.hosting === 'iiif3' ? 'max' : 'full';
  return `${serviceIdOf(settings, path)}/full/${size}/0/default.jpg`;
};

/** URL the manifest will be published at: as typed, or next to the image files. */
export const manifestIdOf = (settings: EditorSettings): string => {
  const typed = settings.manifestId.trim();
  if (typed) return typed;
  if (settings.hosting === 'files' && isHttpUrl(settings.imageBase)) return withSlash(settings.imageBase.trim()) + 'manifest.json';
  return '';
};

export type Problem = 'noImages' | 'imageBase' | 'manifestId' | 'rights';

/** What has to be fixed before the manifest can be downloaded. */
export const problemsOf = (settings: EditorSettings, pages: EditorPage[]): Problem[] => {
  const out: Problem[] = [];
  if (!pages.length) out.push('noImages');
  if (!isHttpUrl(settings.imageBase)) out.push('imageBase');
  if (!isHttpUrl(manifestIdOf(settings))) out.push('manifestId');
  if (settings.rights.trim() && !isHttpUrl(settings.rights)) out.push('rights');
  return out;
};

const lang = (settings: EditorSettings, text: string): Json => ({ [settings.language]: [text] });

const ATTRIBUTION_LABEL: Record<LabelLanguage, string> = { ja: '帰属', en: 'Attribution', none: 'Attribution' };

// 置き場所が未入力でもプレビューはできるように、そのときだけ仮の id を使う（ダウンロードはさせない）
const PREVIEW_ID = 'urn:kasane:manifest-editor';

/**
 * The manifest. With `preview`, images point at the local blob: URLs (no image service) so the
 * viewer on this page can show them now; everything else is the same as what gets downloaded.
 */
export const buildManifest = (settings: EditorSettings, pages: EditorPage[], { preview = false } = {}): Json => {
  const manifestId = manifestIdOf(settings) || PREVIEW_ID;
  // Canvas などの id は、マニフェストの URL から「manifest.json」を外した頭につなぐ（読みに行かれることはない）
  const prefix = manifestId.replace(/\/manifest\.json$/, '').replace(/\.json$/, '');
  const label = settings.label.trim() || 'Untitled';

  const canvases = pages.map((page, i) => {
    const n = i + 1;
    const canvasId = `${prefix}/canvas/p${n}`;
    const body: Json = {
      id: preview ? page.previewUrl : imageUrlOf(settings, page.path),
      type: 'Image',
      format: preview || settings.hosting === 'files' ? page.format : 'image/jpeg',
      width: page.width,
      height: page.height,
    };
    if (!preview && settings.hosting !== 'files') {
      const id = serviceIdOf(settings, page.path);
      body.service = [
        settings.hosting === 'iiif3'
          ? { id, type: 'ImageService3', profile: 'level1' }
          : { '@id': id, '@type': 'ImageService2', profile: 'http://iiif.io/api/image/2/level1.json' },
      ];
    }
    return {
      id: canvasId,
      type: 'Canvas',
      label: lang(settings, page.label.trim() || String(n)),
      width: page.width,
      height: page.height,
      items: [
        {
          id: `${prefix}/page/p${n}/1`,
          type: 'AnnotationPage',
          items: [
            {
              id: `${prefix}/annotation/p${n}-image`,
              type: 'Annotation',
              motivation: 'painting',
              body,
              target: canvasId,
            },
          ],
        },
      ],
    };
  });

  const manifest: Json = {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: manifestId,
    type: 'Manifest',
    label: lang(settings, label),
  };
  if (settings.summary.trim()) manifest.summary = lang(settings, settings.summary.trim());
  if (isHttpUrl(settings.rights)) manifest.rights = settings.rights.trim();
  if (settings.attribution.trim()) {
    manifest.requiredStatement = {
      label: lang(settings, ATTRIBUTION_LABEL[settings.language]),
      value: lang(settings, settings.attribution.trim()),
    };
  }
  if (settings.viewingDirection !== 'left-to-right') manifest.viewingDirection = settings.viewingDirection;
  if (settings.paged) manifest.behavior = ['paged'];
  manifest.items = canvases;
  return manifest;
};

/** Move the item at `from` by `delta` places (clamped to the list). */
export const move = <T,>(list: T[], from: number, delta: number): T[] => {
  const to = Math.min(list.length - 1, Math.max(0, from + delta));
  if (to === from) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};
