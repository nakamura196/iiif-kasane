import type { CSSProperties, ReactNode, Ref } from 'react';
import { useTranslations } from '../env';

// The outside of one annotation in a list: its number (the same number as its mark on the image or
// the model), its heading, and what it says below. Shared by the 3D list (AnnotationCard) and the
// 2D list (the canvas annotations panel), so that both lists look the same.
export function AnnotationCardFrame({
  number,
  title,
  meta,
  selected,
  playing,
  onSelect,
  cardRef,
  annotationId,
  bodyStyle,
  bodyClassName = '',
  children,
}: {
  /** The number shown in the round badge. No badge when absent. */
  number?: number;
  title?: ReactNode;
  /** Small notes on the right of the heading (time, layer, granularity). */
  meta?: ReactNode;
  selected: boolean;
  /** The annotation's time contains the current position of the video or audio. */
  playing?: boolean;
  onSelect: () => void;
  cardRef?: Ref<HTMLDivElement>;
  annotationId?: string;
  bodyStyle?: CSSProperties;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  const indent = number !== undefined ? 'pl-9' : '';
  return (
    <div
      ref={cardRef}
      data-annotation-id={annotationId}
      aria-current={selected || undefined}
      // カードのどこを押しても選ぶ。ただしリンク（写真・参照など）を押したときは、
      // そのリンクを開くだけにして選ばない
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        onSelect();
      }}
      className={`group rounded-lg shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer border overflow-hidden ${
        selected
          ? 'bg-blue-50 dark:bg-blue-900 border-blue-300 dark:border-blue-700'
          : playing
            ? 'bg-white dark:bg-gray-800 border-blue-300 dark:border-blue-700'
            : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-600'
      }`}
    >
      <div className="p-3">
        {number !== undefined || title || meta ? (
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center min-w-0">
              {number !== undefined ? (
                <div
                  className={`shrink-0 min-w-6 h-6 px-1 rounded-full flex items-center justify-center text-white text-xs font-medium tabular-nums ${
                    selected ? 'bg-orange-500' : 'bg-blue-500'
                  }`}
                >
                  {number}
                </div>
              ) : null}
              {title ? (
                <div
                  className={`${number !== undefined ? 'ml-3' : ''} text-sm font-medium break-words min-w-0 ${
                    selected
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-gray-800 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                  }`}
                >
                  {title}
                </div>
              ) : null}
            </div>
            {meta ? (
              <div className="shrink-0 flex gap-2 text-xs text-gray-500 dark:text-gray-400 pt-1">{meta}</div>
            ) : null}
          </div>
        ) : null}
        <div className={`${indent} space-y-1 text-sm text-gray-700 dark:text-gray-300 ${bodyClassName}`} style={bodyStyle}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Annotations on the same region (Shared Region extension): one dashed frame around their cards.
export function RegionGroupFrame({ count, children }: { count: number; children: ReactNode }) {
  const t = useTranslations('Annotation');
  return (
    <div className="rounded-lg border border-dashed border-blue-300 dark:border-blue-700 p-2 space-y-2">
      <div className="px-2 text-xs text-blue-700 dark:text-blue-300">{t('sameRegion', { count })}</div>
      {children}
    </div>
  );
}
