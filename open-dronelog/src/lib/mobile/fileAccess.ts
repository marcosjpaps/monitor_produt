/**
 * Mobile file access helpers (Android-focused scaffold).
 * Keep platform-specific I/O isolated from shared business logic.
 */

export interface MobilePickedFile {
  name: string;
  uri: string;
  mimeType?: string;
  size?: number;
}

export async function pickFlightLogFile(): Promise<MobilePickedFile | null> {
  // Placeholder for SAF/content-uri integration in upcoming milestone.
  return null;
}

export function isContentUri(uri: string): boolean {
  return uri.startsWith('content://');
}
