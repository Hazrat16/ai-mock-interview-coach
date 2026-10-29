import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PhraseCache } from '../../src/speech/phraseCache';

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const key = (text: string, voice = 'v1', lengthScale = 1) => ({ voice, lengthScale, text });

describe('PhraseCache', () => {
  it('returns what was stored, keyed by voice, speed, and text', async () => {
    root = mkdtempSync(join(tmpdir(), 'coach-tts-'));
    const cache = new PhraseCache(join(root, 'tts-cache'));
    expect(await cache.get(key('Thank you.'))).toBeUndefined();
    await cache.set(key('Thank you.'), Buffer.from('wav-1'));
    expect((await cache.get(key('Thank you.')))?.toString()).toBe('wav-1');
    expect(await cache.get(key('Thank you.', 'v2'))).toBeUndefined();
    expect(await cache.get(key('Thank you.', 'v1', 0.9))).toBeUndefined();
  });

  it('does not create its folder until something is stored', async () => {
    root = mkdtempSync(join(tmpdir(), 'coach-tts-'));
    const cache = new PhraseCache(join(root, 'tts-cache'));
    await cache.get(key('x'));
    expect(readdirSync(root)).toEqual([]);
  });

  it('removes the oldest files when full', async () => {
    root = mkdtempSync(join(tmpdir(), 'coach-tts-'));
    const cache = new PhraseCache(root, 10);
    for (let i = 0; i < 11; i++) await cache.set(key(`phrase ${i}`), Buffer.from(String(i)));
    expect(readdirSync(root).filter((f) => f.endsWith('.wav')).length).toBeLessThanOrEqual(10);
    expect(await cache.get(key('phrase 10'))).toBeDefined();
  });
});
