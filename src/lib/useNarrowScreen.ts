import { useSyncExternalStore } from 'react';

// True on a phone-sized screen (below Tailwind's `sm` breakpoint, 640px).
// Pages use it to keep only the main controls on screen and fold the rest into a menu.
const QUERY = '(max-width: 639.98px)';

const subscribe = (onChange: () => void) => {
  const mq = window.matchMedia?.(QUERY);
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
};

export function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(QUERY).matches === true,
    () => false,
  );
}
