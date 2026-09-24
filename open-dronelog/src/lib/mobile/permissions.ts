/**
 * Mobile permission helpers for Android runtime capabilities.
 */

export type PermissionState = 'granted' | 'denied' | 'prompt';

export async function getStoragePermissionState(): Promise<PermissionState> {
  // Placeholder for Android permission bridge.
  return 'prompt';
}

export async function requestStoragePermission(): Promise<PermissionState> {
  // Placeholder for Android permission request flow.
  return 'denied';
}
