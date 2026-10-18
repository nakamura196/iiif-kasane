'use client';

import { sanitizeAboutHtml } from '../../core';
import { useTranslations } from '../env';
import { useAuthPanels } from './authStore';

// IIIF Authorization Flow 2.0 の案内。画像の上に重ねる（画像は、サーバが返す範囲でそのまま描く）。
// active: heading / note / confirmLabel を見せ、ボタンでログイン窓を開く。
// 拒否のままのとき: 理由と「もう一度」。ログインできているときは、ログアウトのリンク。
export default function AuthPrompt() {
  const t = useTranslations('Viewer');
  // several probes behind the same access service (models A and B of the compare page) share one
  // prompt: logging in through it lets the others in too
  const asked = new Set<string>();
  const panels = useAuthPanels().filter(({ state }) => {
    if (state.phase !== 'prompt' || !state.access?.id) return true;
    if (asked.has(state.access.id)) return false;
    asked.add(state.access.id);
    return true;
  });
  return (
    <>
      {panels.map(({ state, controller }) => {
        const a = state.access;
        if (state.phase === 'prompt' && a) {
          return (
            <Box key={controller.probe.id} kind="prompt">
              <p className="font-semibold">{a.heading || a.label || t('authHeading')}</p>
              <Note html={a.note || t('authNote')} />
              <button type="button" data-auth-action="confirm" className={BTN} onClick={() => controller.confirm(a)}>
                {a.confirmLabel || t('authConfirm')}
              </button>
            </Box>
          );
        }
        if (state.phase === 'working') {
          return (
            <Box key={controller.probe.id} kind="working">
              <p className="text-sm">{t('authWorking')}</p>
            </Box>
          );
        }
        if (state.phase === 'denied') {
          return (
            <Box key={controller.probe.id} kind="denied">
              <p className="font-semibold">{state.heading || t('authDeniedHeading')}</p>
              <Note html={state.note || t('authDeniedNote')} />
              <button type="button" data-auth-action="retry" className={BTN} onClick={() => controller.retry()}>
                {t('authRetry')}
              </button>
            </Box>
          );
        }
        if (state.phase === 'ok' && state.logoutOf?.logout) {
          const out = state.logoutOf;
          return (
            <div key={controller.probe.id} className="absolute right-2 bottom-2 z-10" data-auth-panel="logout">
              <button
                type="button"
                data-auth-action="logout"
                className="text-xs underline text-[var(--ds-fg)] bg-[var(--ds-bg)] px-2 py-1 rounded"
                onClick={() => void controller.logout(out)}
              >
                {out.logout!.label || t('authLogout')}
              </button>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

const BTN =
  'mt-2 px-3 py-1.5 rounded border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] hover:opacity-80';

function Box({ kind, children }: { kind: string; children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-4 z-10 flex justify-center pointer-events-none px-4" data-auth-panel={kind}>
      <div
        className="pointer-events-auto max-w-md rounded border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] p-4 shadow"
        role="alert"
      >
        {children}
      </div>
    </div>
  );
}

// note は Presentation API と同じ決まりで HTML を含んでよい（仕様 2.0 の note）
function Note({ html }: { html: string }) {
  return <div className="text-sm [&_a]:underline [&_p]:mb-1" dangerouslySetInnerHTML={{ __html: sanitizeAboutHtml(html) }} />;
}
