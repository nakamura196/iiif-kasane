'use client';

// The one switch that shows or hides the annotation marks: over the 3D model, over the image, and over the page
// thumbnails. All three read the same state (showAnnotationsAtom), so turning the marks off in one place turns them
// off everywhere. The marks of a text search are not affected: the search tab has its own switch for them.

import { useAtom } from 'jotai';
import { showAnnotationsAtom } from '../atoms';
import { useTranslations } from '../env';

export function ShowMarksToggle({ className = '' }: { className?: string }) {
  const t = useTranslations('AnnotationFilter');
  const [show, setShow] = useAtom(showAnnotationsAtom);
  return (
    <label
      className={`inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer select-none ${className}`}
    >
      <input
        type="checkbox"
        checked={show}
        onChange={(e) => setShow(e.target.checked)}
        className="h-3.5 w-3.5 accent-blue-600"
        data-show-marks
      />
      {t('showMarks')}
    </label>
  );
}
