import Popup from '../three/Popup';
import { Html } from '@react-three/drei';
import { Annotation } from '../../core';

export default function AnnotationMarker({
  annotation,
  isOpen,
  onClick,
  label,
  isVisible = true,
  dimmed = false,
  named = false,
  action,
}: {
  annotation: Annotation;
  isOpen: boolean;
  onClick: () => void;
  // Overrides the popup text, e.g. to list every annotation on a shared region.
  label?: string;
  isVisible?: boolean;
  // another note is the one the story step is about: this mark steps back
  dimmed?: boolean;
  // show the name beside the mark while closed (a story is read: the parts are named, as in Voyager)
  named?: boolean;
  // a button in the popup
  action?: { label: string; onClick: () => void };
}) {
  // a note without a title shows the start of its text (tags taken off; React escapes the rest)
  const text = annotation.data.body.value?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  const content = label ?? (annotation.data.body.label || (text.length > 80 ? `${text.slice(0, 80)}…` : text));
  const value = annotation.data.target.selector.value;

  return (
    <Html position={[value[0], value[1], value[2]]} style={{ opacity: !isVisible ? 0.15 : dimmed ? 0.7 : 1 }}>
      <div className="relative">
        {/* マーカー（選択中=太いオレンジの輪、可視=青の輪、非可視/背面=グレーの輪）。
            中を塗ると下の模型が隠れるので、選択中も輪だけで示す */}
        <div
          onClick={onClick}
          className={`w-6 h-6 border-2 rounded-full cursor-pointer transition-all ${
            isOpen
              ? 'border-4 border-orange-500'
              : isVisible
                ? 'border-blue-500 hover:border-blue-600'
                : 'border-gray-400 hover:border-gray-500'
          }`}
        />

        {/* ポップアップ */}
        {isOpen && <Popup content={content} action={action} />}
        {!isOpen && named && content && (
          <div
            onClick={onClick}
            className="absolute left-7 top-0.5 whitespace-nowrap cursor-pointer rounded bg-black/60 px-1.5 py-0.5 text-[11px] leading-tight text-white"
          >
            {content.length > 40 ? `${content.slice(0, 40)}…` : content}
          </div>
        )}
      </div>
    </Html>
  );
}
