import type { ReactNode, Ref } from 'react';
import { useTranslations } from '../env';
import AnnotationResources from './AnnotationResources';
import { AnnotationDetail } from './AnnotationDetail';
import AnnotationBody from './AnnotationBody';
import { AnnotationCardFrame } from './AnnotationCardFrame';
import { otherBodies, sanitizeAnnotationHtml, tagKey } from '../../core';
import type { Annotation, AnnotationGraph } from '../../core';

// What a card says: the description and the other bodies. Also shown in the annotation's detail view.
export function AnnotationCardBody({ annotation }: { annotation: Annotation }) {
  const others = otherBodies(annotation.bodies ?? []);
  return (
    <>
      {/* コンテンツ部分。マニフェストに書かれた HTML なので、許可したタグ・属性だけにしてから出す */}
      <div dangerouslySetInnerHTML={{ __html: sanitizeAnnotationHtml(annotation.data.body.value) }} />

      {/* 2 つ目以降の本文やリンク（Wikidata など）。見せ方は 2D の注釈一覧と同じ部品 */}
      {others.length > 0 && (
        <div className="mt-2 space-y-1">
          {others.map((b, i) => (
            <AnnotationBody key={i} body={b} assumeHtml />
          ))}
        </div>
      )}
    </>
  );
}

// The tags and the creator at the bottom of a card (and of the detail view).
export function AnnotationCardExtras({ annotation }: { annotation: Annotation }) {
  const t = useTranslations('Annotation');
  return (
    <>
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
    </>
  );
}

// The detail view of one annotation in the 3D list (in place of the list).
export function AnnotationCardDetail({
  annotation,
  number,
  graph,
  onBack,
  onSelectAnnotation,
}: {
  annotation: Annotation;
  number?: number;
  graph: AnnotationGraph;
  onBack: () => void;
  onSelectAnnotation: (id: string) => void;
}) {
  return (
    <AnnotationDetail
      annotationId={annotation.id}
      number={number}
      title={annotation.data.body.label}
      resources={annotation.resources}
      graph={graph}
      onBack={onBack}
      onSelectAnnotation={onSelectAnnotation}
      footer={<AnnotationCardExtras annotation={annotation} />}
    >
      <AnnotationCardBody annotation={annotation} />
    </AnnotationDetail>
  );
}

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
  return (
    <AnnotationCardFrame
      number={number}
      title={annotation.data.body.label}
      selected={selected}
      onSelect={() => onSelect(annotation.id)}
      cardRef={cardRef}
      annotationId={annotation.id}
    >
      <AnnotationCardBody annotation={annotation} />

      {/* 関連する資料（場所の写真・Wikidata・Wikipedia・文献）。2D の注釈一覧と同じ部品 */}
      <div>
        <AnnotationResources resources={annotation.resources} />
      </div>

      <AnnotationCardExtras annotation={annotation} />

      {children}
    </AnnotationCardFrame>
  );
}
