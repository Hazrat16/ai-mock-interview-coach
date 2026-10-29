import { randomBytes } from 'node:crypto';

/** UUIDv7: time-ordered, so ids sort by creation time and stay unique across backups and restores. */
export function newId(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6); // 48-bit millisecond timestamp
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const nowIso = () => new Date().toISOString();
