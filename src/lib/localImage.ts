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

/** A one-Canvas Manifest that paints the whole local image. */
export const manifestFromLocalImage = (image: LocalImage): Json => {
  const id = `${LOCAL_ID_PREFIX}${image.digest}`;
  const canvasId = `${id}/canvas/1`;
  return {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id,
    type: 'Manifest',
    label: { none: [image.name] },
    items: [
      {
        id: canvasId,
        type: 'Canvas',
        label: { none: [image.name] },
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
      },
    ],
  };
};

export class LocalImageError extends Error {
  constructor(public readonly reason: 'notImage' | 'decode') {
    super(reason);
  }
}

/** Whether a dropped / picked file looks like an image (some systems give no type; the decoder decides then). */
export const looksLikeImage = (file: { type: string }): boolean => !file.type || file.type.startsWith('image/');

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

// 前に開いた画像の URL。次を開いたときに捨てる（同じタブで何枚も開いてもメモリが増え続けないように）
let opened: string[] = [];

/**
 * Read the file in the browser and return the blob: URL of a manifest for it.
 * Nothing is sent anywhere: the size comes from decoding the image here, the id from hashing it here.
 */
export const openLocalImage = async (file: File): Promise<string> => {
  if (!looksLikeImage(file)) throw new LocalImageError('notImage');
  let width: number;
  let height: number;
  try {
    // <img> と推論（createImageBitmap）と同じく、EXIF の向きを当てた大きさになる
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    throw new LocalImageError('decode');
  }
  if (!(width > 0) || !(height > 0)) throw new LocalImageError('decode');
  const digest = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));

  const imageUrl = URL.createObjectURL(file);
  const manifest = manifestFromLocalImage({
    name: file.name || 'image',
    imageUrl,
    format: file.type || 'image/jpeg',
    width,
    height,
    digest,
  });
  const manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/ld+json' }));

  for (const u of opened) URL.revokeObjectURL(u);
  opened = [imageUrl, manifestUrl];
  return manifestUrl;
};
