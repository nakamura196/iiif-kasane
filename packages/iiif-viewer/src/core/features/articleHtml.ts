// 段の本文に付いた、外の HTML の記事（body が text/html の外部の資源のもの）。
// ビューアは記事の中身を読み替えず、閉じた枠（sandbox の iframe）でそのまま見せる。
// 記事の見た目・画像・動画は、記事を書いた側のものがそのまま出る。
import type { AnnotationBodyItem } from './annotationBody';

/** The bodies of a step that are articles: external HTML resources. */
export const articleBodiesOf = (bodies: AnnotationBodyItem[]): AnnotationBodyItem[] =>
  bodies.filter((b) => b.kind === 'resource' && !!b.url && /html/i.test(b.format ?? ''));

/**
 * The sandbox of the frame an article is shown in. Its scripts run (a video player, say) only when it
 * comes from another site than the viewer: a page of the same site, allowed both scripts and its origin,
 * could reach out of the frame. Null when the URL cannot be shown (not http(s)).
 */
export function articleSandbox(url: string, pageOrigin: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const base = ['allow-popups', 'allow-popups-to-escape-sandbox', 'allow-presentation'];
  return (u.origin === pageOrigin ? base : ['allow-scripts', 'allow-same-origin', ...base]).join(' ');
}
