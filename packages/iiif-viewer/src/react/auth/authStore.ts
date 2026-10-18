'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  parseProbeResult,
  parseTokenMessage,
  type AuthAccessRef,
  type AuthProbeRef,
  type AuthProbeResult,
  type AuthSubstitute,
} from '../../core';

// IIIF Authorization Flow API 2.0 のクライアント（https://iiif.io/api/auth/2.0/ の "Workflow from the Client Perspective"）。
// Probe service ごとに 1 つの進行（Controller）を持ち、複数の画像が同じ Probe を共有できる。
// アクセストークンはメモリだけに置く（localStorage には入れない）。

export type AuthPhase =
  | 'probing' // asking the probe / the services
  | 'ok' // the resource is allowed (or substituted)
  | 'prompt' // an active access service waits for the user's click
  | 'working' // the access window is open, or a token is being fetched
  | 'denied'; // nothing worked

export interface AuthState {
  phase: AuthPhase;
  /** Bumped after each successful login/logout: reload images (info.json and tiles) when it changes. */
  epoch: number;
  /** The access service the prompt is about (phase "prompt"/"working"). */
  access?: AuthAccessRef;
  /** The access service whose logout can be offered (after a login). */
  logoutOf?: AuthAccessRef;
  /** Resource to load instead (probe status 30x with `location`), once allowed. */
  location?: AuthSubstitute;
  /** Resource to show until the user is let in (probe status 401 with `substitute`, e.g. a degraded copy). */
  substitute?: AuthSubstitute;
  heading?: string;
  note?: string;
}

const TOKEN_TIMEOUT_MS = 10_000;
const WINDOW_POLL_MS = 500;
const WINDOW_POLL_MAX = 20 * 60 * 2; // 20 minutes

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class Controller {
  state: AuthState = { phase: 'probing', epoch: 0 };
  refs = 0;
  private listeners = new Set<() => void>();
  private tokens = new Map<string, { token: string; until: number }>();
  private run = 0;
  private clickWaiter: ((win: Window | null) => void) | null = null;

  constructor(
    readonly probe: AuthProbeRef,
    private locale: string,
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  private set(next: Partial<AuthState>, replace = false) {
    this.state = replace ? ({ epoch: this.state.epoch, ...next } as AuthState) : { ...this.state, ...next };
    this.listeners.forEach((l) => l());
    notify();
  }

  private tokenFor(tokenId: string): string | undefined {
    const t = this.tokens.get(tokenId);
    if (t && t.until > Date.now()) return t.token;
    this.tokens.delete(tokenId);
    return undefined;
  }

  // GET the probe with the token as Bearer. No cookies: the spec makes the token the credential
  // here, and servers answer with CORS `*`, which a request with cookies is refused under
  // (Wellcome Collection does).
  private async probeOnce(token?: string): Promise<AuthProbeResult | null> {
    try {
      const r = await fetch(this.probe.id, {
        credentials: 'omit',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return null;
      return parseProbeResult(await r.json(), this.locale);
    } catch {
      return null;
    }
  }

  private allowed(r: AuthProbeResult | null): boolean {
    return !!r && (r.status === 200 || (r.status >= 300 && r.status < 400 && !!r.location));
  }

  private finishOk(r: AuthProbeResult, reload: boolean) {
    this.set(
      { phase: 'ok', access: undefined, location: r.location, substitute: undefined, heading: undefined, note: undefined, epoch: this.state.epoch + (reload ? 1 : 0) },
    );
  }

  // The client workflow: probe, probe with known tokens, then access services (external, kiosk, active).
  async start(reload = false) {
    const id = ++this.run;
    const live = () => id === this.run;
    this.set({ phase: 'probing', access: undefined }, false);
    let last = await this.probeOnce();
    if (!live()) return;
    if (last && this.allowed(last)) return this.finishOk(last, reload);
    // degraded access: show the substitute now, and go on to offer the access services
    if (last?.substitute) this.set({ substitute: last.substitute });
    for (const a of this.probe.access) {
      const known = this.tokenFor(a.tokenId);
      if (!known) continue;
      const r = await this.probeOnce(known);
      if (!live()) return;
      if (r && this.allowed(r)) return this.finishOk(r, reload);
      last = r ?? last;
    }
    // Already logged in (a cookie from an earlier visit): the token service answers without any
    // window, so ask it quietly before showing a prompt. The spec lets the client ask it at any time.
    for (const a of this.probe.access) {
      if (a.profile === 'external') continue; // tried below without a window anyway
      const got = await this.fetchToken(a);
      if (!live()) return;
      if (!got.ok) continue;
      const r = await this.probeOnce(got.token);
      if (!live()) return;
      if (r && this.allowed(r)) {
        this.set({ logoutOf: a });
        return this.finishOk(r, true);
      }
      last = r ?? last;
    }
    let message = { heading: last?.heading, note: last?.note };
    for (const a of this.probe.access) {
      if (a.profile === 'active' || a.profile === 'kiosk') {
        let win: Window | null = null;
        if (a.profile === 'active') {
          this.set({ phase: 'prompt', access: a });
          win = await new Promise<Window | null>((resolve) => {
            this.clickWaiter = resolve;
          });
          if (!live()) return;
        } else {
          win = window.open(accessUrl(a), '_blank');
          // popup blocked: fall back to asking
          if (!win) {
            this.set({ phase: 'prompt', access: a });
            win = await new Promise<Window | null>((resolve) => {
              this.clickWaiter = resolve;
            });
            if (!live()) return;
          }
        }
        this.set({ phase: 'working', access: a });
        await waitClosed(win);
        if (!live()) return;
      } else {
        this.set({ phase: 'working', access: a });
      }
      const got = await this.fetchToken(a);
      if (!live()) return;
      if (!got.ok) {
        message = { heading: got.heading ?? a.tokenErrorHeading, note: got.note ?? a.tokenErrorNote };
        continue;
      }
      const r = await this.probeOnce(got.token);
      if (!live()) return;
      if (r && this.allowed(r)) {
        this.set({ logoutOf: a });
        this.finishOk(r, true);
        if (a.id) wakeWaiting(this, a.id);
        return;
      }
      last = r ?? last;
      message = { heading: last?.heading, note: last?.note };
    }
    this.set({
      phase: 'denied',
      access: this.probe.access.find((a) => a.profile === 'active') ?? this.probe.access[0],
      heading: message.heading || this.probe.errorHeading || undefined,
      note: message.note || this.probe.errorNote || undefined,
    });
  }

  /** The user pressed the button of the prompt: open the access window now (inside the click). */
  confirm(a: AuthAccessRef) {
    const win = window.open(accessUrl(a), '_blank');
    const waiter = this.clickWaiter;
    this.clickWaiter = null;
    waiter?.(win);
  }

  retry() {
    void this.start(true);
  }

  /** Open the logout service; when its window closes, forget the tokens and probe again. */
  async logout(a: AuthAccessRef) {
    if (!a.logout) return;
    const win = window.open(a.logout.id, '_blank');
    await waitClosed(win);
    this.tokens.clear();
    this.set({ logoutOf: undefined, epoch: this.state.epoch + 1 });
    await this.start(true);
  }

  private fetchToken(a: AuthAccessRef): Promise<{ ok: true; token: string } | { ok: false; heading?: string; note?: string }> {
    return new Promise((resolve) => {
      const messageId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      let tokenOrigin = '';
      try {
        tokenOrigin = new URL(a.tokenId, location.href).origin;
      } catch {
        resolve({ ok: false });
        return;
      }
      const timer = setTimeout(() => done({ ok: false }), TOKEN_TIMEOUT_MS);
      const done = (v: { ok: true; token: string } | { ok: false; heading?: string; note?: string }) => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        iframe.remove();
        resolve(v);
      };
      const onMessage = (e: MessageEvent) => {
        if (e.origin !== tokenOrigin) return;
        const m = parseTokenMessage(e.data, messageId, this.locale);
        if (!m) return;
        if (m.ok) {
          this.tokens.set(a.tokenId, { token: m.accessToken, until: Date.now() + (m.expiresIn ?? 300) * 1000 });
          done({ ok: true, token: m.accessToken });
        } else done({ ok: false, heading: m.heading, note: m.note });
      };
      // listen before the iframe gets its src
      window.addEventListener('message', onMessage);

      const sep = a.tokenId.includes('?') ? '&' : '?';
      iframe.src = `${a.tokenId}${sep}messageId=${encodeURIComponent(messageId)}&origin=${encodeURIComponent(location.origin)}`;
      document.body.appendChild(iframe);
    });
  }

  retain() {
    this.refs++;
    notify();
  }
  release() {
    this.refs--;
    notify();
  }
}

const accessUrl = (a: AuthAccessRef) => `${a.id}${a.id?.includes('?') ? '&' : '?'}origin=${encodeURIComponent(location.origin)}`;

// poll until the window closes (capped)
const waitClosed = async (win: Window | null) => {
  if (!win) return;
  for (let i = 0; i < WINDOW_POLL_MAX && !win.closed; i++) await sleep(WINDOW_POLL_MS);
};

// ---- registry: one Controller per probe URL

const controllers = new Map<string, Controller>();
const globalListeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  globalListeners.forEach((l) => l());
};

// After a login through an access service, other probes that wait for the user on the same service
// (e.g. models A and B of the compare page) ask again: the token service now answers without a window.
function wakeWaiting(from: Controller, accessId: string) {
  controllers.forEach((c) => {
    if (c !== from && c.refs > 0 && c.state.phase === 'prompt' && c.probe.access.some((a) => a.id === accessId)) void c.start(true);
  });
}

/** Starts (once) and shares the Controller of a probe while a component uses it. */
export function useAuth(probe: AuthProbeRef | undefined, locale: string): { state: AuthState; controller: Controller } | undefined {
  const c = probe ? getController(probe, locale) : undefined;
  useEffect(() => {
    if (!c) return;
    c.retain();
    return () => c.release();
  }, [c]);
  const state = useSyncExternalStore(
    c ? c.subscribe : noopSubscribe,
    c ? c.getState : () => undefined,
    () => undefined,
  );
  return c && state ? { state, controller: c } : undefined;
}

const noopSubscribe = () => () => {};

function getController(probe: AuthProbeRef, locale: string): Controller {
  let c = controllers.get(probe.id);
  if (!c) {
    c = new Controller(probe, locale);
    controllers.set(probe.id, c);
    const started = c;
    queueMicrotask(() => void started.start());
  }
  return c;
}

/**
 * The auth state of several resources at once (e.g. the models of a 3D Scene, whose number varies),
 * one entry per probe; undefined where the resource has no probe.
 */
export function useAuthStates(probes: (AuthProbeRef | undefined)[], locale: string): (AuthState | undefined)[] {
  const key = probes.map((p) => p?.id ?? '').join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the probe ids (key) decide which controllers are used
  const cs = useMemo(() => probes.map((p) => (p ? getController(p, locale) : undefined)), [key, locale]);
  useEffect(() => {
    const used = cs.filter((c): c is Controller => !!c);
    used.forEach((c) => c.retain());
    return () => used.forEach((c) => c.release());
  }, [cs]);
  useSyncExternalStore(subscribeAll, () => version, () => 0);
  return cs.map((c) => c?.state);
}

const subscribeAll = (fn: () => void) => {
  globalListeners.add(fn);
  return () => {
    globalListeners.delete(fn);
  };
};

/** Controllers in use right now that need the user's attention (a prompt, an error, a logout link). */
export function useAuthPanels(): { state: AuthState; controller: Controller }[] {
  const v = useSyncExternalStore(
    (fn) => {
      globalListeners.add(fn);
      return () => {
        globalListeners.delete(fn);
      };
    },
    () => version,
    () => 0,
  );
  void v;
  return [...controllers.values()]
    .filter((c) => c.refs > 0)
    .map((c) => ({ state: c.state, controller: c }));
}

export type { Controller };
