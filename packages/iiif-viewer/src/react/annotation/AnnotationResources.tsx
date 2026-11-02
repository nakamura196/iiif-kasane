'use client';

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
 * and related resources (pictures, Wikipedia, web pages, references). The same in the 2D and the 3D lists.
 */
export default function AnnotationResources({ resources }: { resources?: AnnotationResource[] }) {
  const t = useTranslations('AnnotationResources');
  const locale = useLocale();
  if (!resources || resources.length === 0) return null;
  const place = resources.filter((r) => r.role === 'place' && r.kind === 'image');
  const identifying = resources.filter((r) => r.role === 'identifying');
  const related = resources.filter((r) => !place.includes(r) && !identifying.includes(r));
  const relatedImages = related.filter((r) => r.kind === 'image');
  const links = related.filter((r) => r.kind !== 'image' && r.kind !== 'citation');
  const citations = related.filter((r) => r.kind === 'citation');
  return (
    <div className="mt-2 space-y-2" data-annotation-resources>
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
