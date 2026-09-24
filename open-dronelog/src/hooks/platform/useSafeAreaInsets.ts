import { useEffect, useState } from 'react';

interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function useSafeAreaInsets(): SafeAreaInsets {
  const [insets, setInsets] = useState<SafeAreaInsets>(ZERO_INSETS);

  useEffect(() => {
    // CSS env() is the source of truth for notches and gesture bars on mobile browsers/webviews.
    const readInset = (varName: string): number => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      const value = Number.parseFloat(raw.replace('px', ''));
      return Number.isFinite(value) ? value : 0;
    };

    const update = () => {
      setInsets({
        top: readInset('env(safe-area-inset-top)'),
        right: readInset('env(safe-area-inset-right)'),
        bottom: readInset('env(safe-area-inset-bottom)'),
        left: readInset('env(safe-area-inset-left)'),
      });
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return insets;
}
