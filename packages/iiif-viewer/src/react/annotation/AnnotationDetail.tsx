'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { AnnotationGraph, AnnotationResource } from '../../core';
import { useTranslations } from '../env';
import { AnnotationCardFrame } from './AnnotationCardFrame';
import { AnnotationNetwork } from './AnnotationNetwork';
import AnnotationResources from './AnnotationResources';

/**
 * One annotation in the right panel in place of the list: its heading and body (the same content as its card), its
 * related resources opened, and the diagram of what it connects to. "Back" returns to the list.
 * Shared by the 2D and the 3D annotation lists; each passes the content of its own card as `children`.
 */
export function AnnotationDetail({
  annotationId,
  number,
  title,
  meta,
  bodyStyle,
  bodyClassName,
  resources,
  graph,
  onBack,
  onSelectAnnotation,
  footer,
  children,
}: {
  annotationId: string;
  number?: number;
  title?: ReactNode;
  meta?: ReactNode;
  bodyStyle?: CSSProperties;
  bodyClassName?: string;
  resources?: AnnotationResource[];
  graph: AnnotationGraph;
  /** Return to the list (and deselect the annotation). */
  onBack: () => void;
  /** Go to another annotation from the diagram. */
  onSelectAnnotation: (id: string) => void;
  /** Shown below the diagram (tags, creator). */
  footer?: ReactNode;
  /** The body: what the card shows, except the related resources. */
  children?: ReactNode;
}) {
  const t = useTranslations('AnnotationConnections');

  // Escape goes back, unless it was meant for something else: a typed field, or the diagram's open preview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[data-network-popover]')) return;
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div className="space-y-3" data-annotation-detail>
      <button type="button" onClick={onBack} className="text-sm text-[var(--ds-primary)] hover:underline">
        {t('backToList')}
      </button>
      <AnnotationCardFrame
        plain
        selected
        number={number}
        title={title}
        meta={meta}
        annotationId={annotationId}
        bodyStyle={bodyStyle}
        bodyClassName={bodyClassName}
        onSelect={() => {}}
      >
        {children}
        <AnnotationResources resources={resources} defaultOpen />
        <div className="pt-2">
          <AnnotationNetwork key={annotationId} graph={graph} annotationId={annotationId} onSelectAnnotation={onSelectAnnotation} large />
        </div>
        {footer}
      </AnnotationCardFrame>
    </div>
  );
}
