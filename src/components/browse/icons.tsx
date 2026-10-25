// 3D で一覧するページのアイコン。Kasane の他の画面と同じく、依存を足さずに SVG を直に書く
// （線の太さ・角の丸めは SidePanel の矢印などに合わせた）。
import type { BrowseLayout } from '@/lib/browse';

const Svg = ({ children, className = 'w-4 h-4' }: { children: React.ReactNode; className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** 並べ方ごとの形 */
export const LayoutIcon = ({ layout, className }: { layout: BrowseLayout; className?: string }) => {
  switch (layout) {
    case 'table':
      return (
        <Svg className={className}>
          <rect x="3" y="5" width="4.5" height="5.5" rx="0.8" />
          <rect x="9.75" y="5" width="4.5" height="5.5" rx="0.8" />
          <rect x="16.5" y="5" width="4.5" height="5.5" rx="0.8" />
          <rect x="3" y="13.5" width="4.5" height="5.5" rx="0.8" />
          <rect x="9.75" y="13.5" width="4.5" height="5.5" rx="0.8" />
        </Svg>
      );
    case 'sphere':
      return (
        <Svg className={className}>
          <circle cx="12" cy="12" r="8.5" />
          <ellipse cx="12" cy="12" rx="3.8" ry="8.5" />
          <path d="M3.5 12h17" />
        </Svg>
      );
    case 'helix':
      return (
        <Svg className={className}>
          <ellipse cx="12" cy="6" rx="8" ry="2.4" />
          <ellipse cx="12" cy="12" rx="8" ry="2.4" />
          <ellipse cx="12" cy="18" rx="8" ry="2.4" />
        </Svg>
      );
    case 'grid':
      // 見出しの付いた板が並ぶ形
      return (
        <Svg className={className}>
          <rect x="3" y="4" width="8" height="7" rx="1" />
          <rect x="13" y="4" width="8" height="11" rx="1" />
          <rect x="3" y="13" width="8" height="7" rx="1" />
          <path d="M3 6.5h8M13 6.5h8M3 15.5h8" />
        </Svg>
      );
  }
};

export const ChevronIcon = ({ dir, className }: { dir: 'left' | 'right'; className?: string }) => (
  <Svg className={className}>
    <path d={dir === 'left' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
  </Svg>
);

/** 視点を戻す（反時計回りの矢印） */
export const ResetIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <path d="M4 4v5h5" />
    <path d="M5.2 15a7.5 7.5 0 1 0 1.6-7.6L4 9" />
  </Svg>
);

/** カードを正面に向ける（こちらを向いた板） */
export const FaceFrontIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <rect x="6" y="4" width="12" height="16" rx="1.2" />
    <circle cx="12" cy="11" r="2.2" />
  </Svg>
);

export const CloseIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const SearchIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </Svg>
);

export const ExpandIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </Svg>
);

/** Keep（しおり）。filled で塗る */
export const KeepIcon = ({ filled = false, className }: { filled?: boolean; className?: string }) => (
  <svg
    className={className ?? 'w-4 h-4'}
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
  </svg>
);

export const InfoIcon = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

/** 入口の画面の大きな印（3D に並んだカード） */
export const StackIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M12 3l8.5 4.5L12 12 3.5 7.5 12 3zM3.5 12L12 16.5 20.5 12M3.5 16.5L12 21l8.5-4.5"
    />
  </svg>
);
