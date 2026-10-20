import type { PublicEvent } from './model';

const key = 'valet-finished-events-v1';
type Entry = { version: string; event: PublicEvent };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

// Only public snapshots belong here. The fresh event catalog authorizes access
// and supplies the version before a snapshot can be used.
export function createFinishedEventCache(storage: () => Storage) {
  function entries(): Entry[] {
    try {
      const value = JSON.parse(storage().getItem(key) ?? '[]');
      return Array.isArray(value) ? value.filter((item) =>
        item?.event?.status === 'finished' && typeof item.version === 'string') : [];
    } catch { return []; }
  }
  return {
    read(id: string, version?: string): PublicEvent | null {
      if (!version) return null;
      return entries().find((item) => item.event.id === id && item.version === version)?.event ?? null;
    },
    write(event: PublicEvent, version?: string) {
      const remaining = entries().filter((item) => item.event.id !== event.id);
      if (event.status === 'finished' && version) remaining.unshift({ version, event });
      // Bound local storage; unavailable/full storage must never interrupt scores.
      try { storage().setItem(key, JSON.stringify(remaining.slice(0, 8))); } catch {}
    },
  };
}
