import { isCuration, resolveCuration } from '../features/curation';
import { upgradeToV3 } from './upgradeV2';
import { isImageInfoJson } from '../features/compareSources';
import { manifestFromImageInfo } from './imageInfoManifest';
import { manifestFromCanvas } from './canvasManifest';
import { manifestFromAnnotationPage } from './annotationPageManifest';
import { inlineSharedServices } from './sharedServices';

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return response.json();
};

/**
 * URL の JSON を取ってくる。http:// で読めなければ https:// でもう一度試す
 * （https のページからは http に繋げない。古いマニフェストやキュレーションは http:// で書かれていることが多い）。
 */
export const fetchJson = async (url: string): Promise<unknown> => {
  try {
    return await getJson(url);
  } catch (error) {
    if (!/^http:\/\//i.test(url)) throw error;
    return getJson(url.replace(/^http:/i, 'https:'));
  }
};

// 同じマニフェストを、画面の準備・画像の表示・ページ側がそれぞれ取りに来る（開いた直後に 3 回）。
// 東大の画像サーバのように遅い所では、後から来た取得の待ちがそのまま絵の出る遅れになるので、
// 同じ URL は 1 回の取得を分け合う。結果は少しのあいだだけ覚える（編集中の取り直しと、多数のマニフェストを開く Collection のため）。
const MANIFEST_REUSE_MS = 60_000;
const manifestCache = new Map<string, ReturnType<typeof readManifest>>();

/**
 * The manifest at the URL, made into Presentation 3 (null when it could not be read).
 * Calls for the same URL within a minute share one request.
 */
export const fetchManifest = (manifestUrl: string): ReturnType<typeof readManifest> => {
  let p = manifestCache.get(manifestUrl);
  if (!p) {
    p = readManifest(manifestUrl);
    manifestCache.set(manifestUrl, p);
    const own = p;
    p.then((raw) => {
      // a failure is asked again next time; a success is reused for a while
      const forget = () => {
        if (manifestCache.get(manifestUrl) === own) manifestCache.delete(manifestUrl);
      };
      if (raw === null) forget();
      else setTimeout(forget, MANIFEST_REUSE_MS);
    });
  }
  return p;
};

const readManifest = async (manifestUrl: string) => {
  try {
    const raw = await fetchJson(manifestUrl);
    // 画像 1 枚の info.json は、その画像だけを載せた仮のマニフェストにする
    if (isImageInfoJson(raw)) {
      const built = manifestFromImageInfo(raw, manifestUrl);
      if (!built) throw new Error('The image information could not be read');
      return built;
    }
    // Canvas 単体（geo.ldas.jp の canvas.json など）は、その Canvas だけを載せた仮のマニフェストにする
    const fromCanvas = manifestFromCanvas(raw, manifestUrl);
    if (fromCanvas) return fromCanvas;
    // AnnotationPage 単体（geo.ldas.jp・Allmaps の地点の注釈）は、注釈が指す画像ごとに Canvas を立てたマニフェストにする
    const fromPage = manifestFromAnnotationPage(raw, manifestUrl);
    if (fromPage) return fromPage;
    // キュレーション（cr:Curation）は、元のマニフェストを取ってきて 1 冊の仮のマニフェストにする
    if (isCuration(raw)) {
      const built = await resolveCuration(raw, fetchJson);
      if (!built) throw new Error('No canvas of the curation could be read');
      return built;
    }
    // Presentation 2 は 3 に直してから渡す（3 / 4 はそのまま）。末尾の services への参照は中身に置き換える
    return inlineSharedServices(upgradeToV3(raw));
  } catch (error) {
    console.error('Error fetching manifest:', error);
    return null;
  }
};
