'use client';

import { useEffect, useState } from 'react';
import {
  imageOfBody,
  isImageBody,
  labelIn,
  pickWikidataLabel,
  sanitizeAnnotationHtml,
  wikidataIdOf,
  wikidataLabelUrl,
  type AnnotationBodyItem,
} from '../../core';
import { useLocale, useTranslations } from '../env';
import { useCanvasNavigation } from '../navigation';
import AnnotationImages from './AnnotationImages';

// A text body without a format is plain text, unless the list says otherwise (the 3D editor writes HTML without one).
const isHtml = (b: AnnotationBodyItem, assumeHtml = false) => (b.format ? /html/i.test(b.format) : assumeHtml);
const plainText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Wikidata のラベル。同じ項目は 1 回だけ取りに行く。失敗は覚えず、表示は URL のままにする。
const wikidataCache = new Map<string, Promise<string | undefined>>();

const fetchWikidataLabel = (id: string, locale: string): Promise<string | undefined> => {
  const key = `${id}|${locale}`;
  let p = wikidataCache.get(key);
  if (!p) {
    p = fetch(wikidataLabelUrl(id, locale), { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => pickWikidataLabel(json, id, locale));
    p.catch(() => wikidataCache.delete(key));
    wikidataCache.set(key, p);
  }
  return p;
};

function useWikidataLabel(url: string, locale: string, enabled: boolean): string | undefined {
  const id = enabled ? wikidataIdOf(url) : undefined;
  const [label, setLabel] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchWikidataLabel(id, locale).then(
      (text) => {
        if (!cancelled && text) setLabel({ key: `${id}|${locale}`, text });
      },
      () => {}, // quietly keep the URL
    );
    return () => {
      cancelled = true;
    };
  }, [id, locale]);
  return id && label?.key === `${id}|${locale}` ? label.text : undefined;
}

const NO_CANVASES = new Map<string, string>();

/**
 * One body of an annotation: a text (plain or HTML), a keyed tag, a picture, or a link (a Canvas of this item,
 * a web page, a Wikidata item shown by its name). Used by the 2D and the 3D annotation lists.
 */
export default function AnnotationBody({
  body,
  canvasLabels = NO_CANVASES,
  assumeHtml = false,
}: {
  body: AnnotationBodyItem;
  /** The Canvases of this item by id: a link to one of them moves the viewer there. */
  canvasLabels?: Map<string, string>;
  /** Read a text without a format as HTML. */
  assumeHtml?: boolean;
}) {
  const t = useTranslations('Info');
  const locale = useLocale();
  const { goToCanvas } = useCanvasNavigation();
  const wikidata = useWikidataLabel(body.url ?? '', locale, body.kind !== 'text' && !labelIn(body.label, locale));
  if (body.kind === 'text') {
    const key = body.tagging ? labelIn(body.label, locale) : '';
    if (key) {
      // a keyed tag (Keyed Tag extension): "key: value"
      return (
        <p className="text-sm text-gray-800 dark:text-gray-100 break-words" lang={body.language}>
          <span className="text-gray-500 dark:text-gray-300">{key}: </span>
          {isHtml(body, assumeHtml) ? plainText(body.value ?? '') : body.value}
        </p>
      );
    }
    if (isHtml(body, assumeHtml)) {
      // サニタイズ済み（許可したタグ・属性だけ）
      return (
        <div
          className="text-sm text-gray-800 dark:text-gray-100 break-words [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_img]:inline [&_img]:h-5 [&_p]:my-1"
          lang={body.language}
          dangerouslySetInnerHTML={{ __html: sanitizeAnnotationHtml(body.value ?? '') }}
        />
      );
    }
    return (
      <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words" lang={body.language}>
        {body.value}
      </p>
    );
  }
  const url = body.url ?? '';
  const isWeb = /^https?:\/\//i.test(url);
  const own = canvasLabels.get(url);
  const givenLabel = labelIn(body.label, locale) || own;
  const label = givenLabel || wikidata || url;
  if (isWeb && isImageBody(body)) {
    // a picture in the annotation (recipe 0377): show it; the picture opens the holding institution's page, else the full image
    return <AnnotationImages images={[imageOfBody(body, locale)]} />;
  }
  if (own !== undefined) {
    // a Canvas of this item: the button moves the viewer there
    return (
      <button
        type="button"
        className="block w-fit text-xs text-blue-600 dark:text-blue-400 underline break-words text-left"
        title={t('canvasAnnotationsCanvasLink')}
        onClick={(e) => {
          e.stopPropagation();
          goToCanvas(url);
        }}
      >
        {label}
      </button>
    );
  }
  if (!isWeb) return <p className="text-xs text-gray-500 dark:text-gray-300 break-all">{label}</p>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-fit text-xs text-blue-600 dark:text-blue-400 underline break-all"
      title={t('canvasAnnotationsOpen')}
    >
      {label}
    </a>
  );
}
