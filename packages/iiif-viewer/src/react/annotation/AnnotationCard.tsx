import type { ReactNode, Ref } from 'react';
import { useTranslations } from '../env';
import { SeeAlso, type PrimitivesExternalWebResource } from '../iiif/primitives';
import AnnotationImages from '../annotation/AnnotationImages';
import AnnotationBody from './AnnotationBody';
import { otherBodies, sanitizeAnnotationHtml, tagKey } from '../../core';
import type { Annotation } from '../../core';

// One annotation as a card: number, label, description and other bodies, images, tags, creator, seeAlso.
// Shared by the viewer's annotation list and the georeferencing page, so that what an
// annotation shows (for example its images) is defined in one place.
export default function AnnotationCard({
  annotation,
  number,
  selected,
  onSelect,
  cardRef,
  children,
}: {
  annotation: Annotation;
  number?: number;
  selected: boolean;
  onSelect: (id: string) => void;
  cardRef?: Ref<HTMLDivElement>;
  // page-specific additions shown at the bottom of the card
  children?: ReactNode;
}) {
  const t = useTranslations('Annotation');
  const others = otherBodies(annotation.bodies ?? []);
  return (
    <div
      ref={cardRef}
      // カードのどこを押しても選ぶ。ただしリンク（写真・参照など）を押したときは、
      // そのリンクを開くだけにして選ばない
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        onSelect(annotation.id);
      }}
      className={`group rounded-lg shadow-sm hover:shadow-md transition-all duration-200 
          cursor-pointer border overflow-hidden
          ${
            selected
              ? 'bg-blue-50 dark:bg-blue-900 border-blue-300 dark:border-blue-700'
              : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-600'
          }`}
    >
      <div className="p-4">
        {/* ヘッダー部分 */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-sm font-medium
                            ${
                              selected
                                ? 'bg-blue-600'
                                : 'bg-blue-500'
                            }`}
            >
              {number}
            </div>
            <div
              className={`ml-3 text-sm font-medium
                            ${
                              selected
                                ? 'text-blue-700 dark:text-blue-300'
                                : 'text-gray-600 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                            }`}
            >
              {annotation.data.body.label}
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('type')}: {annotation.data?.target?.selector?.type || t('unknown')}
            </span>
          </div>
        </div>

        {/* コンテンツ部分。マニフェストに書かれた HTML なので、許可したタグ・属性だけにしてから出す */}
        <div
          className="text-gray-700 dark:text-gray-300 text-sm pl-9"
          dangerouslySetInnerHTML={{ __html: sanitizeAnnotationHtml(annotation.data.body.value) }}
        />

        {/* 2 つ目以降の本文やリンク（Wikidata など）。見せ方は 2D の注釈一覧と同じ部品 */}
        {others.length > 0 && (
          <div className="mt-2 pl-9 space-y-1">
            {others.map((b, i) => (
              <AnnotationBody key={i} body={b} assumeHtml />
            ))}
          </div>
        )}

        {/* 画像は、場所そのものの写真と、関連する外部の資料（purpose: linking）を分けて見せる */}
        {[
          { key: 'images', items: annotation.images?.filter((i) => i.purpose !== 'linking') ?? [] },
          { key: 'relatedImages', items: annotation.images?.filter((i) => i.purpose === 'linking') ?? [] },
        ].map(({ key, items }) =>
          items.length > 0 && (
            <div key={key} className="mt-3 pl-9">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t(key)}
              </div>
              <AnnotationImages images={items} />
            </div>
          ),
        )}

        {annotation.tags && annotation.tags.length > 0 && (
          <div className="mt-3 pl-9 flex flex-wrap gap-1.5">
            {annotation.tags.map((tag, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
              >
                {tagKey(tag)}
              </span>
            ))}
          </div>
        )}

        {annotation.creator && (
          <div className="mt-2 pl-9 text-xs text-gray-500 dark:text-gray-400">
            {t('creator')}: {annotation.creator}
          </div>
        )}

        {annotation.seeAlso && annotation.seeAlso.length > 0 && (
          <div className="mt-3 pl-9 text-sm">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t('seeAlso')}
            </div>
            <SeeAlso seeAlso={annotation.seeAlso as unknown as PrimitivesExternalWebResource[]} />
          </div>
        )}

        {children}

        {/* アクションボタン */}
        {/*
        <div className="mt-3 pl-9 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="text-xs text-blue-500 hover:text-blue-600 font-medium">
            詳細を見る
          </button>
        </div>
        */}
      </div>
    </div>
  );
}
