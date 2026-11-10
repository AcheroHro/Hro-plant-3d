import { useEffect, useState } from 'react';

/** Disposición de la pantalla: teléfono vertical, teléfono horizontal o escritorio/tablet (null) */
export type PhoneLayout = 'portrait' | 'landscape' | null;

const QUERY_PORTRAIT = '(max-width: 767px)';
const QUERY_LANDSCAPE = '(max-height: 520px) and (orientation: landscape)';

export function getPhoneLayout(): PhoneLayout {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  if (window.matchMedia(QUERY_LANDSCAPE).matches) return 'landscape';
  if (window.matchMedia(QUERY_PORTRAIT).matches) return 'portrait';
  return null;
}

export function usePhoneLayout(): PhoneLayout {
  const [layout, setLayout] = useState<PhoneLayout>(getPhoneLayout);
  useEffect(() => {
    if (!window.matchMedia) return;
    const queries = [window.matchMedia(QUERY_PORTRAIT), window.matchMedia(QUERY_LANDSCAPE)];
    const update = () => setLayout(getPhoneLayout());
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return layout;
}

export const vibrate = (ms = 10) => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(ms);
    } catch {
      // El navegador no lo permite
    }
  }
};
