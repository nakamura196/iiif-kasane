'use client';

import type { ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import {
  aboutOf,
  safeAboutUrl,
  type AboutAgent,
  type AboutLink,
  type AboutPlace,
  type AboutScope,
} from '../../core';
import { manifestAtom } from '../atoms';
import { useContentLocale, useTranslations } from '../env';
import { MetadataList, SafeHtml } from './SafeHtml';
import type { Panel, PanelContext } from './types';

const LINK_CLASS = 'text-blue-600 dark:text-blue-400 hover:underline break-words';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b pb-2 border-gray-200 dark:border-gray-700">
    <div className="text-sm text-gray-500 dark:text-gray-400">{title}</div>
    <div className="text-gray-900 dark:text-gray-100 space-y-1">{children}</div>
  </div>
);

const Links = ({ links }: { links: AboutLink[] }) => (
  <>
    {links.map((l, i) => {
      const href = safeAboutUrl(l.id);
      return (
        <div key={i}>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
              {l.label}
            </a>
          ) : (
            <span>{l.label}</span>
          )}
          {(l.format || l.type) && (
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{l.format || l.type}</span>
          )}
        </div>
      );
    })}
  </>
);

const Agent = ({ agent }: { agent: AboutAgent }) => {
  const href = safeAboutUrl(agent.homepage[0]?.id ?? agent.id ?? '');
  const logos = agent.logos.map((src) => safeAboutUrl(src)).filter(Boolean);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        {logos.slice(0, 1).map((src) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt="" className="h-8 w-auto max-w-[8rem] object-contain" />
        ))}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            {agent.label || href}
          </a>
        ) : (
          <span>{agent.label}</span>
        )}
      </div>
      {agent.homepage.length > 1 && <Links links={agent.homepage.slice(1)} />}
    </div>
  );
};

// 場所は座標の一覧と OpenStreetMap への外部リンクで示す（地図の部品は持たない）。
const Place = ({ place }: { place: AboutPlace }) => {
  const t = useTranslations('About');
  const c = place.center;
  return (
    <div>
      {place.label && <div>{place.label}</div>}
      <div className="text-sm text-gray-600 dark:text-gray-300">
        {place.geometry} {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
        {place.points > 1 && ` (${t('vertices', { count: place.points })})`}
      </div>
      {place.target && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('region')}: {place.target.replace(/^#/, '')}
        </div>
      )}
      <a href={place.url} target="_blank" rel="noopener noreferrer" className={`${LINK_CLASS} text-sm`}>
        {t('openMap')}
      </a>
    </div>
  );
};

// Mirador に倣い、右パネルを「資料情報」（何の資料か）と「権利」（使ってよいか・誰のものか）に分ける。
// 資料情報は、表示中のページ → 資料全体 → 目次の項目の順に並べる。

function InfoScope({ scope, title }: { scope: AboutScope; title: boolean }) {
  const t = useTranslations('About');
  const links: [string, AboutLink[]][] = [
    [t('homepage'), scope.homepage],
    [t('download'), scope.rendering],
    [t('seeAlso'), scope.seeAlso],
    [t('partOf'), scope.partOf],
  ];
  return (
    <div className="space-y-4">
      {title && scope.label && <Section title={t('title')}>{scope.label}</Section>}
      {scope.thumbnails.length > 0 && (
        <Section title={t('thumbnail')}>
          <div className="flex flex-wrap gap-2">
            {scope.thumbnails.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={safeAboutUrl(src)}
                alt=""
                className="max-h-32 w-auto rounded border border-gray-200 dark:border-gray-700 object-contain"
              />
            ))}
          </div>
        </Section>
      )}
      {scope.summary.length > 0 && (
        <Section title={t('description')}>
          {scope.summary.map((h, i) => (
            <SafeHtml key={i} html={h} as="div" />
          ))}
        </Section>
      )}
      {scope.metadata.length > 0 && (
        <Section title={t('metadata')}>
          <MetadataList items={scope.metadata} />
        </Section>
      )}
      {scope.navDate && (
        <Section title={t('date')}>
          <time dateTime={scope.navDate.iso}>{scope.navDate.text}</time>
        </Section>
      )}
      {scope.places.length > 0 && (
        <Section title={t('place')}>
          {scope.places.map((p, i) => (
            <Place key={i} place={p} />
          ))}
        </Section>
      )}
      {links.map(([name, list]) =>
        list.length > 0 ? (
          <Section key={name} title={name}>
            <Links links={list} />
          </Section>
        ) : null,
      )}
    </div>
  );
}

function RightsScope({ scope }: { scope: AboutScope }) {
  const t = useTranslations('About');
  return (
    <div className="space-y-4">
      {scope.requiredStatement && (
        <Section title={scope.requiredStatement.label || t('attribution')}>
          <MetadataList items={[{ ...scope.requiredStatement, label: '' }]} />
        </Section>
      )}
      {scope.rights && (
        <Section title={t('license')}>
          {safeAboutUrl(scope.rights.url) ? (
            <a href={safeAboutUrl(scope.rights.url)} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
              {scope.rights.label}
            </a>
          ) : (
            <span>{scope.rights.label}</span>
          )}
        </Section>
      )}
      {scope.providers.length > 0 && (
        <Section title={t('provider')}>
          {scope.providers.map((a, i) => (
            <Agent key={i} agent={a} />
          ))}
        </Section>
      )}
    </div>
  );
}

const hasInfo = (s: AboutScope): boolean =>
  !!(
    s.summary.length ||
    s.metadata.length ||
    s.thumbnails.length ||
    s.navDate ||
    s.places.length ||
    s.homepage.length ||
    s.rendering.length ||
    s.seeAlso.length ||
    s.partOf.length
  );
const hasRights = (s: AboutScope): boolean => !!(s.requiredStatement || s.rights || s.providers.length);

const Heading = ({ children, sub }: { children: ReactNode; sub?: string }) => (
  <h3 className="font-semibold text-gray-800 dark:text-gray-100">
    {children}
    {sub && <span className="ml-2 font-normal">{sub}</span>}
  </h3>
);

function useAbout({ container, manifest }: PanelContext) {
  const locale = useContentLocale();
  const fromAtom = useAtomValue(manifestAtom);
  return aboutOf(manifest ?? fromAtom, container?.id, locale);
}

/** 資料情報: 表示中のページ、資料全体、目次の項目。 */
export function InfoView(ctx: PanelContext) {
  const t = useTranslations('About');
  const info = useAbout(ctx);
  if (!info) return null;
  const page = info.container && hasInfo(info.container) ? info.container : undefined;
  return (
    <div className="p-6 space-y-6">
      {page && (
        <div className="space-y-3">
          <Heading sub={page.label}>{t('thisPage')}</Heading>
          <InfoScope scope={page} title={false} />
        </div>
      )}
      <div className="space-y-3">
        <Heading>{t('thisResource')}</Heading>
        <InfoScope scope={info.manifest} title />
      </div>
      {info.ranges.length > 0 && (
        <div className="space-y-3">
          <Heading>{t('ranges')}</Heading>
          {info.ranges.map((r) => (
            <div key={r.id} className="space-y-2">
              <div className="font-medium text-gray-700 dark:text-gray-300">{r.label || r.id}</div>
              <InfoScope scope={r} title={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 権利: 出典表記・ライセンス・提供者。ページや目次の項目が別の権利を持つときは、それも出す。 */
function RightsView(ctx: PanelContext) {
  const t = useTranslations('About');
  const info = useAbout(ctx);
  if (!info) return null;
  const others = [
    ...(info.container && hasRights(info.container) ? [{ scope: info.container, title: t('thisPage') }] : []),
    ...info.ranges.filter(hasRights).map((r) => ({ scope: r, title: t('ranges') })),
  ];
  return (
    <div className="p-6 space-y-6">
      {hasRights(info.manifest) && (
        <div className="space-y-3">
          {others.length > 0 && <Heading>{t('thisResource')}</Heading>}
          <RightsScope scope={info.manifest} />
        </div>
      )}
      {others.map(({ scope, title }) => (
        <div key={scope.id} className="space-y-3">
          <Heading sub={scope.label}>{title}</Heading>
          <RightsScope scope={scope} />
        </div>
      ))}
    </div>
  );
}

export const infoPanel: Panel = {
  // URL の ?tab=metadata を壊さないよう、id は前のまま
  id: 'metadata',

  order: 10,
  available: () => true,
  Component: (ctx) => <InfoView {...ctx} />,
};

export const rightsPanel: Panel = {
  id: 'rights',

  order: 50,
  available: ({ manifest, container }) => {
    const info = aboutOf(manifest, container?.id, 'en');
    return !!info && [info.manifest, info.container, ...info.ranges].some((s) => !!s && hasRights(s));
  },
  Component: (ctx) => <RightsView {...ctx} />,
};
