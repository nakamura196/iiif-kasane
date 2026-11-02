// 手元の画像ファイルを、サーバに送らずにビューアで開く。
// ビューアは「マニフェストの URL を 1 つ受け取る」作りなので、画像をブラウザの中だけで有効な URL（blob:）にし、
// その画像 1 枚を載せた仮のマニフェスト（Presentation 3）を作って、それも blob: の URL にして渡す。
// blob: の URL はこのタブの中でしか読めず、再読み込みやタブを閉じると消える。アドレス欄には書かない。

type Json = Record<string, unknown>;

export interface LocalImage {
  /** File name, shown as the manifest label. */
  name: string;
  /** blob: URL of the image itself. */
  imageUrl: string;
  /** MIME type of the image. */
  format: string;
  width: number;
  height: number;
  /** SHA-256 of the file contents (hex), so the same file gets the same Canvas id each time it is opened. */
  digest: string;
}

/** Prefix of the ids given to local images (not a URL: nothing can be fetched from it). */
export const LOCAL_ID_PREFIX = 'urn:kasane:local:sha256:';

/** True when the manifest URL is one made here (a blob: URL in this tab). */
export const isLocalManifestUrl = (url: string | null | undefined): boolean => !!url && url.startsWith('blob:');

const canvasOf = (image: LocalImage, n: number): Json => {
  // Canvas の id は画像の中身だけで決める。同じ画像なら、1 枚で開いても束の中で開いても同じ id になる
  const canvasId = `${LOCAL_ID_PREFIX}${image.digest}/canvas/1`;
  return {
    id: canvasId,
    type: 'Canvas',
    label: { none: [image.name || String(n)] },
    width: image.width,
    height: image.height,
    items: [
      {
        id: `${canvasId}/page`,
        type: 'AnnotationPage',
        items: [
          {
            id: `${canvasId}/page/image`,
            type: 'Annotation',
            motivation: 'painting',
            target: canvasId,
            body: {
              id: image.imageUrl,
              type: 'Image',
              format: image.format,
              width: image.width,
              height: image.height,
            },
          },
        ],
      },
    ],
  };
};

/**
 * A Manifest with one Canvas per local image, in the given order.
 * `digest` is the id of the whole set (for one image, the image's own digest).
 */
export const manifestFromLocalImages = (images: LocalImage[], label: string, digest: string): Json => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id: `${LOCAL_ID_PREFIX}${digest}`,
  type: 'Manifest',
  label: { none: [label] },
  items: images.map((image, i) => canvasOf(image, i + 1)),
});

/** A one-Canvas Manifest that paints the whole local image. */
export const manifestFromLocalImage = (image: LocalImage): Json =>
  manifestFromLocalImages([image], image.name, image.digest);

type Named = { name: string; webkitRelativePath?: string };

/** Path of a file within the picked / dropped folder, or just its name. */
export const pathOf = (file: Named): string => file.webkitRelativePath || file.name;

// 数字は数として比べる（2 が 10 より前）。スキャン画像は 001.jpg、p2.jpg のように名前に番号を持つことが多い
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Order of pages: by folder and file name, numbers compared as numbers. */
export const sortFiles = <T extends Named>(files: T[]): T[] =>
  [...files].sort((a, b) => collator.compare(pathOf(a), pathOf(b)));

/** Name of the set: the folder they all share, else the first file's name. */
export const labelOf = (files: Named[]): string => {
  if (files.length === 1) return files[0].name || 'image';
  const folders = new Set(files.map((f) => pathOf(f).split('/').slice(0, -1).join('/')));
  const [folder] = [...folders];
  if (folders.size === 1 && folder) return folder.split('/').pop() || folder;
  return files[0].name;
};

export class LocalImageError extends Error {
  constructor(public readonly reason: 'notImage' | 'decode' | 'tooMany') {
    super(reason);
  }
}

/** Upper limit on the number of images opened at once (each is decoded and hashed in this tab). */
export const MAX_LOCAL_IMAGES = 2000;

/** Whether a dropped / picked file looks like an image (some systems give no type; the decoder decides then). */
export const looksLikeImage = (file: { type: string }): boolean => !file.type || file.type.startsWith('image/');

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

// 前に開いた画像の URL。次を開いたときに捨てる（同じタブで何度も開いてもメモリが増え続けないように）
let opened: string[] = [];

export interface OpenedLocalImages {
  /** blob: URL of the manifest. */
  manifestUrl: string;
  /** Label of the manifest (folder name or file name). */
  label: string;
  /** Number of images in it. */
  count: number;
  /** Files skipped because they are not images or this browser could not decode them. */
  skipped: string[];
}

const readImage = async (file: File): Promise<Omit<LocalImage, 'imageUrl'> | null> => {
  if (!looksLikeImage(file)) return null;
  let width: number;
  let height: number;
  try {
    // <img> と推論（createImageBitmap）と同じく、EXIF の向きを当てた大きさになる
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    return null;
  }
  if (!(width > 0) || !(height > 0)) return null;
  const digest = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return { name: file.name || 'image', format: file.type || 'image/jpeg', width, height, digest };
};

/** An image read in this tab, with the file it came from. */
export interface ReadLocalImage extends Omit<LocalImage, 'imageUrl'> {
  file: File;
  /** Path within the picked / dropped folder, or the file name. */
  path: string;
}

/**
 * Decode and hash the files in this tab, ordered by file name. Files that are not images (or that this
 * browser cannot decode) are skipped, and the same image given twice is kept once. Nothing is sent anywhere.
 */
export const readLocalImages = async (
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ images: ReadLocalImage[]; skipped: string[] }> => {
  // フォルダごと開くと、システムが作る隠しファイル（.DS_Store、._001.jpg など）が混ざるので黙って除く
  const candidates = sortFiles(files.filter((f) => !f.name.startsWith('.')));
  if (candidates.length > MAX_LOCAL_IMAGES) throw new LocalImageError('tooMany');
  const images: ReadLocalImage[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  // 1 枚ずつ読む（まとめて読むと、大きな画像が多いときにメモリが足りなくなる）
  for (const [i, file] of candidates.entries()) {
    onProgress?.(i, candidates.length);
    const image = await readImage(file);
    if (!image) skipped.push(pathOf(file));
    else if (!seen.has(image.digest)) {
      seen.add(image.digest);
      images.push({ ...image, file, path: pathOf(file) });
    }
  }
  if (!images.length) throw new LocalImageError(candidates.some(looksLikeImage) ? 'decode' : 'notImage');
  return { images, skipped };
};

/**
 * Read the files in the browser and return the blob: URL of a manifest with one Canvas per image,
 * ordered by file name. Files that are not images (or that this browser cannot decode) are skipped,
 * and the same image given twice is kept once. Nothing is sent anywhere: sizes come from decoding
 * here, ids from hashing here.
 */
export const openLocalImages = async (
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<OpenedLocalImages> => {
  const { images, skipped } = await readLocalImages(files, onProgress);
  const kept = images.map((im) => im.file);

  // 束全体の id は、並べた画像の中身から決める（同じ画像を同じ順で開けば同じ id）
  const digest =
    images.length === 1
      ? images[0].digest
      : hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(images.map((im) => im.digest).join('\n'))));
  const urls = kept.map((file) => URL.createObjectURL(file));
  const label = labelOf(kept);
  const manifest = manifestFromLocalImages(
    images.map(({ name, format, width, height, digest: d }, i) => ({ name, format, width, height, digest: d, imageUrl: urls[i] })),
    label,
    digest,
  );
  const manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/ld+json' }));

  for (const u of opened) URL.revokeObjectURL(u);
  opened = [...urls, manifestUrl];
  return { manifestUrl, label, count: images.length, skipped };
};

/** Read one file in the browser and return the blob: URL of a one-Canvas manifest for it. */
export const openLocalImage = async (file: File): Promise<string> => (await openLocalImages([file])).manifestUrl;

const withPath = (file: File, path: string): File => {
  // フォルダの名前で束の名前と並び順を決めるので、フォルダの中での位置を持たせる
  Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
  return file;
};

const readAll = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // readEntries は 1 回に 100 件ほどしか返さないので、空が返るまで呼び直す
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });

/**
 * Files carried by a drop, including those inside dropped folders (read recursively).
 * Falls back to the plain file list when nothing dropped is a folder.
 */
export const filesFromDataTransfer = async (dt: DataTransfer): Promise<File[]> => {
  // items は await の後には空になるので、先に entry を取り出しておく
  const entries = Array.from(dt.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  const plain = Array.from(dt.files);
  if (!entries.some((e) => e.isDirectory)) return plain;
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push(withPath(file, entry.fullPath.replace(/^\//, '')));
      return;
    }
    for (const child of await readAll((entry as FileSystemDirectoryEntry).createReader())) await walk(child);
  };
  for (const e of entries) await walk(e);
  return out;
};
