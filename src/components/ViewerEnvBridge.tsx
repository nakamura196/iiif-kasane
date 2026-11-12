'use client';

import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { useTheme } from 'next-themes';
import { ViewerEnv, viewerMessages } from 'iiif-kasane';

// next-intl の言語と next-themes の明暗を、パッケージの部品に渡す橋渡し。
export default function ViewerEnvBridge({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  return (
    <ViewerEnv
      locale={locale}
      messages={locale === 'en' ? viewerMessages.en : viewerMessages.ja}
      resolvedTheme={resolvedTheme === 'dark' ? 'dark' : 'light'}
    >
      {children}
    </ViewerEnv>
  );
}
