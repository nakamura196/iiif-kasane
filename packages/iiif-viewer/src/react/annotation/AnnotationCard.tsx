import type { ReactNode, Ref } from 'react';
import { useTranslations } from '../env';
import AnnotationResources from './AnnotationResources';
import AnnotationBody from './AnnotationBody';
import { AnnotationCardFrame } from './AnnotationCardFrame';
import { otherBodies, sanitizeAnnotationHtml, tagKey } from '../../core';
import type { Annotation } from '../../core';

// One annotation as a card (the frame is shared with the 2D list): number, label, description and other bodies, images, tags, creator, seeAlso.
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
    <AnnotationCardFrame
      number={number}
      title={annotation.data.body.label}
      selected={selected}
      onSelect={() => onSelect(annotation.id)}
      cardRef={cardRef}
      annotationId={annotation.id}
    >
        {/* コンテンツ部分。マニフェストに書かれた HTML なので、許可したタグ・属性だけにしてから出す */}
        <div
          dangerouslySetInnerHTML={{ __html: sanitizeAnnotationHtml(annotation.data.body.value) }}
        />

        {/* 2 つ目以降の本文やリンク（Wikidata など）。見せ方は 2D の注釈一覧と同じ部品 */}
        {others.length > 0 && (
          <div className="mt-2 space-y-1">
            {others.map((b, i) => (
              <AnnotationBody key={i} body={b} assumeHtml />
            ))}
          </div>
        )}

        {/* 関連する資料（場所の写真・Wikidata・Wikipedia・文献）。2D の注釈一覧と同じ部品 */}
        <div>
          <AnnotationResources resources={annotation.resources} />
        </div>

        {annotation.tags && annotation.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
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
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t('creator')}: {annotation.creator}
          </div>
        )}

        {children}

    </AnnotationCardFrame>
  );
}
