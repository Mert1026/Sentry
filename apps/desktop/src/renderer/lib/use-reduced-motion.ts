import React from 'react';
import { isReducedMotionEnabled } from './app-preferences.js';

const PREFS_EVENT = 'sentry:preferences-changed';

/**
 * Live reduced-motion flag: true when the OS asks for it or the user turned
 * "Workspace Motion & Animations" off in Settings. CSS animations are cut
 * globally; JS/SMIL-driven motion (edge pulses, traveling dots, camera
 * moves) must check this hook so the whole product honors the setting.
 */
export function useReducedMotion(): boolean {
  const read = (): boolean => {
    const os =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return os || isReducedMotionEnabled();
  };
  const [reduced, setReduced] = React.useState<boolean>(read);
  React.useEffect(() => {
    const onChange = (): void => setReduced(read());
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    media?.addEventListener('change', onChange);
    window.addEventListener(PREFS_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      media?.removeEventListener('change', onChange);
      window.removeEventListener(PREFS_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return reduced;
}
