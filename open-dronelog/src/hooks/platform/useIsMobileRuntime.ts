import { useMemo } from 'react';

export function useIsMobileRuntime(): boolean {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent.toLowerCase();
    return ua.includes('android') || /iphone|ipad|ipod/.test(ua);
  }, []);
}
