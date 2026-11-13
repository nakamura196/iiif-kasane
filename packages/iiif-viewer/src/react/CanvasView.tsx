'use client';

import type { ReactNode } from 'react';
import ContainerList from './ContainerList';
import { DISPLAYS } from './displays/registry';
import { useTranslations } from './env';
import { LoadingOverlay } from './layout/Loading';
import { useViewer } from './ViewerProvider';
import type { ViewerActionsState } from './Viewer';

export interface CanvasViewProps {
  /** false: hide the previous / next buttons above the image. The arrow keys still turn the pages. */
  pager?: boolean;
  /** Extra controls placed next to the model choice (bottom left of the 3D view). */
  renderActions?: (state: ViewerActionsState) => ReactNode;
  /** Classes added to the outer element (a flex column). Give it a size, e.g. "h-96" or "flex-1". */
  className?: string;
}

/**
 * The shown Canvas / Scene of the surrounding `ViewerProvider`: the page buttons and the image,
 * 3D, video or audio display that fits it. Without the side panel.
 */
export function CanvasView({ pager, renderActions, className = '' }: CanvasViewProps) {
  const t = useTranslations('Viewer');
  const { iiifContent, shownUrl, manifest, failed, containers, selectedIndex, container, select } = useViewer();

  const display = container ? DISPLAYS.find((d) => d.match(container)) : undefined;

  let view: ReactNode;
  if (failed) {
    view = <div className="p-4 text-sm text-[var(--ds-fg)]" role="alert">{t('manifestError')}</div>;
  } else if (!manifest) {
    view = (
      <div className="relative w-full h-full min-h-40">
        <LoadingOverlay label={t('loadingManifest')} />
      </div>
    );
  } else if (!container) {
    view = <div className="p-4 text-sm text-[var(--ds-fg)]">{t('empty')}</div>;
  } else if (!display) {
    view = <div className="p-4 text-sm text-[var(--ds-fg)]">{t('unsupportedContent')}</div>;
  } else {
    view = (
      <display.Component
        container={container}
        manifest={manifest}
        iiifContent={iiifContent}
        shownUrl={shownUrl}
        containers={containers}
        selectedIndex={selectedIndex}
        select={select}
        renderActions={renderActions}
      />
    );
  }

  return (
    <div className={`min-h-0 min-w-0 flex flex-col bg-gray-100 dark:bg-gray-900 ${className}`.trim()}>
      <ContainerList containers={containers} selected={selectedIndex} onSelect={select} pager={pager} />
      {display && container ? view : <div className="relative flex-1 min-h-0 min-w-0">{view}</div>}
    </div>
  );
}

export default CanvasView;
