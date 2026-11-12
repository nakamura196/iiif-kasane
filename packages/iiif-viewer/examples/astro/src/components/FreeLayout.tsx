// The viewer's parts placed in a layout of your own. ViewerProvider loads the manifest and holds the
// shown Canvas; the parts inside it read the same state, so a click on an annotation in the list
// moves the 3D view, and the metadata follows the page turns.
import {
  AnnotationList,
  CanvasView,
  Metadata,
  ViewerProvider,
  useViewer,
  type ViewerSelection,
} from '@nakamura196/iiif-viewer';
import { labelIn } from '@nakamura196/iiif-viewer/core';
import '@nakamura196/iiif-viewer/style.css';
import { useState } from 'react';

// A part of your own: reads the provider's state with useViewer(). IIIF labels are language maps
// ({ en: [...], none: [...] }); labelIn picks one language as a string.
function PageLabel() {
  const { container, selectedIndex, containers } = useViewer();
  if (!container) return null;
  return (
    <p className="page-label">
      {selectedIndex + 1} / {containers.length}: {labelIn(container.label, 'en') || container.id}
    </p>
  );
}

export default function FreeLayout({ manifest }: { manifest: string }) {
  const [shown, setShown] = useState<ViewerSelection | null>(null);
  return (
    <>
      {/* The provider draws one <div class="iiif-viewer">; className makes it your layout's container. */}
      <ViewerProvider iiifContent={manifest} locale="en" theme="light" className="free-layout" onSelect={setShown}>
        <section className="area-view">
          <PageLabel />
          <CanvasView className="view" />
        </section>
        {/* AnnotationList has its own heading, search and "show on model" switch. */}
        <section className="area-annotations">
          <AnnotationList />
        </section>
        <section className="area-metadata">
          <h2>About</h2>
          <Metadata />
        </section>
      </ViewerProvider>
      <p>onSelect: {shown ? `${shown.index}, ${shown.canvasId}` : '(not yet)'}</p>
    </>
  );
}
