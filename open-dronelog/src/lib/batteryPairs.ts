import { useEffect, useState } from 'react';
import { getBatteryPairs } from '@/lib/api';
import { normalizeSerial } from '@/lib/utils';

export interface BatteryPairIndex {
  partnerBySerial: Map<string, string>;
  groupKeyBySerial: Map<string, string>;
  membersByGroupKey: Map<string, string[]>;
}

const EMPTY_INDEX: BatteryPairIndex = {
  partnerBySerial: new Map(),
  groupKeyBySerial: new Map(),
  membersByGroupKey: new Map(),
};

function parsePairToken(raw: string): [string, string] | null {
  const [left, right, ...rest] = raw.split(':').map((p) => normalizeSerial(p));
  if (rest.length > 0) return null;
  if (!isSerialLike(left) || !isSerialLike(right)) return null;
  if (!left || !right || left === right) return null;
  return [left, right];
}

function isSerialLike(value: string): boolean {
  if (!value || value.length < 4) return false;
  if (!/[0-9]/.test(value)) return false;
  return /^[A-Z0-9._-]+$/.test(value);
}

export function buildBatteryPairIndex(pairTokens: string[]): BatteryPairIndex {
  const partnerBySerial = new Map<string, string>();
  const groupKeyBySerial = new Map<string, string>();
  const membersByGroupKey = new Map<string, string[]>();

  for (const token of pairTokens) {
    const parsed = parsePairToken(token);
    if (!parsed) continue;
    const [a, b] = parsed;

    // Keep first valid explicit partner mapping to avoid ambiguous chains.
    if (!partnerBySerial.has(a) && !partnerBySerial.has(b)) {
      partnerBySerial.set(a, b);
      partnerBySerial.set(b, a);
    }
  }

  const visited = new Set<string>();
  for (const serial of partnerBySerial.keys()) {
    if (visited.has(serial)) continue;
    const partner = partnerBySerial.get(serial);
    if (!partner) continue;

    const members = [serial, partner].sort((x, y) => x.localeCompare(y));
    const groupKey = members.join('|');
    membersByGroupKey.set(groupKey, members);

    for (const member of members) {
      groupKeyBySerial.set(member, groupKey);
      visited.add(member);
    }
  }

  return { partnerBySerial, groupKeyBySerial, membersByGroupKey };
}

let cachedPromise: Promise<BatteryPairIndex> | null = null;

export async function loadBatteryPairIndex(): Promise<BatteryPairIndex> {
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    try {
      const tokens = await getBatteryPairs();
      const index = buildBatteryPairIndex(Array.isArray(tokens) ? tokens : []);
      console.debug(
        '[battery-pairs] loaded definitions',
        {
          rawCount: Array.isArray(tokens) ? tokens.length : 0,
          normalizedPairCount: index.membersByGroupKey.size,
        },
      );
      return index;
    } catch {
      console.debug('[battery-pairs] failed to load definitions, using empty mapping');
      return EMPTY_INDEX;
    }
  })();

  return cachedPromise;
}

export function useBatteryPairIndex(): BatteryPairIndex {
  const [index, setIndex] = useState<BatteryPairIndex>(EMPTY_INDEX);

  useEffect(() => {
    let cancelled = false;
    loadBatteryPairIndex().then((loaded) => {
      if (!cancelled) {
        setIndex(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return index;
}

export function getBatteryGroupMembers(serial: string, index: BatteryPairIndex): string[] {
  const normalized = normalizeSerial(serial);
  if (!normalized) return [];
  const groupKey = index.groupKeyBySerial.get(normalized);
  if (!groupKey) return [normalized];
  return index.membersByGroupKey.get(groupKey) ?? [normalized];
}

export function getBatteryGroupKey(serial: string, index: BatteryPairIndex): string {
  const normalized = normalizeSerial(serial);
  if (!normalized) return '';
  return index.groupKeyBySerial.get(normalized) ?? `solo:${normalized}`;
}

export function getPairedBatteryDisplayName(
  serial: string,
  index: BatteryPairIndex,
  getBatteryDisplayName: (serial: string) => string,
): string {
  const members = getBatteryGroupMembers(serial, index);
  if (members.length <= 1) {
    return getBatteryDisplayName(normalizeSerial(serial));
  }
  return members.map((member) => getBatteryDisplayName(member)).join(' + ');
}
