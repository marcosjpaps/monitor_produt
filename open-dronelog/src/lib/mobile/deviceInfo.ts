/**
 * Runtime capability probes for mobile-targeted behavior toggles.
 */

export interface DeviceInfo {
  platform: 'android' | 'ios' | 'desktop' | 'web';
  isTouchPrimary: boolean;
}

export function getDeviceInfo(): DeviceInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const isAndroid = ua.includes('android');
  const isIOS = /iphone|ipad|ipod/.test(ua);

  if (isAndroid) {
    return { platform: 'android', isTouchPrimary: true };
  }

  if (isIOS) {
    return { platform: 'ios', isTouchPrimary: true };
  }

  if (typeof window !== 'undefined' && 'ontouchstart' in window) {
    return { platform: 'web', isTouchPrimary: true };
  }

  return { platform: 'desktop', isTouchPrimary: false };
}
