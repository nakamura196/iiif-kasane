'use client';

import { useId, useState, type SyntheticEvent } from 'react';
import { localizedString, type AnnotationResource } from '../../core';
import { useLocale, useTranslations } from '../env';
import AnnotationBody from './AnnotationBody';
import AnnotationImages from './AnnotationImages';

const asImage = (r: AnnotationResource, locale: string) => {
  const label = localizedString(r.label, locale);
  const homepageLabel = localizedString(r.homepageLabel, locale);
  return {
    id: r.url ?? '',
    ...(label ? { label } : {}),
    ...(r.format ? { format: r.format } : {}),
    ...(r.service ? { service: r.service } : {}),
    ...(r.homepage ? { homepage: r.homepage } : {}),
    ...(homepageLabel ? { homepageLabel } : {}),
  };
};

function Heading({ children }: { children: string }) {
  return <div className="text-xs text-gray-500 dark:text-gray-300 mb-1">{children}</div>;
}

// One link: a small tag for what it is (Wikidata, Wikipedia), then its name. Wikidata without a name shows the item's name.
function ResourceLink({ resource }: { resource: AnnotationResource }) {
  const t = useTranslations('AnnotationResources');
  const tag = resource.kind === 'wikidata' ? 'Wikidata' : resource.kind === 'wikipedia' ? 'Wikipedia' : null;
  const locale = useLocale();
  const text = localizedString(resource.label, locale);
  // the tag says it is Wikipedia, so the editor's "Wikipedia: " prefix is dropped
  const label = tag ? text.replace(/^Wikipedia:\s*/i, '') : text;
  return (
    <div className="flex items-baseline gap-1.5" title={tag ? t(`kind_${resource.kind}`) : undefined}>
      {tag ? (
        <span className="shrink-0 rounded bg-gray-100 dark:bg-gray-700 px-1 text-[10px] leading-4 text-gray-600 dark:text-gray-200">
          {tag}
        </span>
      ) : null}
      <AnnotationBody body={{ kind: 'resource', url: resource.url, ...(label ? { label } : {}) }} />
    </div>
  );
}

/**
 * The related resources of an annotation, in groups: pictures of the place, what the region depicts (Wikidata),
 * and related resources (pictures, Wikipedia, web pages, references). Shown inside the dialog.
 */
export function AnnotationResourcesContent({ resources }: { resources: AnnotationResource[] }) {
  const t = useTranslations('AnnotationResources');
  const locale = useLocale();
  const place = resources.filter((r) => r.role === 'place' && r.kind === 'image');
  const identifying = resources.filter((r) => r.role === 'identifying');
  const related = resources.filter((r) => !place.includes(r) && !identifying.includes(r));
  const relatedImages = related.filter((r) => r.kind === 'image');
  const links = related.filter((r) => r.kind !== 'image' && r.kind !== 'citation');
  const citations = related.filter((r) => r.kind === 'citation');
  return (
    <div className="space-y-3" data-annotation-resources>
      {place.length > 0 ? (
        <div>
          <Heading>{t('place')}</Heading>
          <AnnotationImages images={place.map((r) => asImage(r, locale))} />
        </div>
      ) : null}
      {identifying.length > 0 ? (
        <div>
          <Heading>{t('identifying')}</Heading>
          <div className="space-y-0.5">
            {identifying.map((r, i) => (
              <ResourceLink key={i} resource={r} />
            ))}
          </div>
        </div>
      ) : null}
      {relatedImages.length + links.length + citations.length > 0 ? (
        <div className="space-y-1.5">
          <Heading>{t('related')}</Heading>
          {relatedImages.length > 0 ? <AnnotationImages images={relatedImages.map((r) => asImage(r, locale))} /> : null}
          {links.length > 0 ? (
            <div className="space-y-0.5">
              {links.map((r, i) => (
                <ResourceLink key={i} resource={r} />
              ))}
            </div>
          ) : null}
          {citations.length > 0 ? (
            <ul className="space-y-1 list-none">
              {citations.map((r, i) => (
                <li
                  key={i}
                  className="border-l-2 border-gray-300 dark:border-gray-600 pl-2 text-xs text-gray-700 dark:text-gray-200 break-words"
                  title={t('kind_citation')}
                >
                  {localizedString(r.label, locale)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Clicks inside the opened part must not reach the card: a click on the card selects the annotation and moves the view.
const stop = (e: SyntheticEvent) => e.stopPropagation();

// What the button says: how many of each kind, so that the list stays short but tells what is there.
const summarize = (resources: AnnotationResource[]) => {
  const images = resources.filter((r) => r.kind === 'image').length;
  const citations = resources.filter((r) => r.kind === 'citation').length;
  return { images, citations, links: resources.length - images - citations };
};

/**
 * The related resources of an annotation, folded into one small button in the card. Pressing it opens them in
 * place (an accordion), so a list with many pictures stays easy to scan and the model stays visible.
 * The same in the 2D and the 3D lists.
 */
export default function AnnotationResources({ resources }: { resources?: AnnotationResource[] }) {
  const t = useTranslations('AnnotationResources');
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (!resources || resources.length === 0) return null;
  const { images, links, citations } = summarize(resources);
  const parts = [
    images > 0 ? t('countImages', { count: images }) : null,
    links > 0 ? t('countLinks', { count: links }) : null,
    citations > 0 ? t('countCitations', { count: citations }) : null,
  ].filter(Boolean);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-controls={panelId}
        data-annotation-resources-button
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>
          ▸
        </span>
        <span>{t('open')}</span>
        {parts.length > 0 ? <span className="text-gray-500 dark:text-gray-400">{parts.join(' · ')}</span> : null}
      </button>
      {open ? (
        <div
          id={panelId}
          onClick={stop}
          onPointerDown={stop}
          onKeyDown={stop}
          className="mt-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-2 cursor-auto"
        >
          <AnnotationResourcesContent resources={resources} />
        </div>
      ) : null}
    </div>
  );
}
