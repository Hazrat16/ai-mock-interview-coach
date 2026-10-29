import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechPlayer } from './player';

// Minimal stand-ins for the browser audio API: a "sound" ends when the test calls finish().
type FakeSource = { onended?: () => void; started: boolean; text: string };
let sources: FakeSource[];
let resumeWorks: boolean;
let fetched: string[];
let failText: string | undefined;

class FakeAudioContext {
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  destination = {};
  resume() {
    if (resumeWorks) this.state = 'running';
    return resumeWorks ? Promise.resolve() : new Promise<void>(() => undefined); // never settles without a click
  }
  decodeAudioData(buf: ArrayBuffer) {
    return Promise.resolve({ text: new TextDecoder().decode(buf) });
  }
  createBufferSource() {
    const src: FakeSource & Record<string, unknown> = {
      started: false,
      text: '',
      connect: () => undefined,
      start: () => {
        src.started = true;
        src.text = (src.buffer as { text: string }).text;
        sources.push(src);
      },
      stop: () => src.onended?.(),
    };
    return src;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
/** Lets pending fetches and decodes settle. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};
const finish = (i: number) => sources[i]!.onended?.();

beforeEach(() => {
  sources = [];
  fetched = [];
  resumeWorks = true;
  failText = undefined;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const { text } = JSON.parse(init.body as string) as { text: string };
    fetched.push(text);
    if (text === failText)
      return new Response(JSON.stringify({ error: 'Piper is down', hint: 'Start it' }), { status: 503 });
    return new Response(text);
  });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('SpeechPlayer', () => {
  it('plays sentences in order and fetches the next one while the current one plays', async () => {
    const p = new SpeechPlayer();
    const done = p.speak('Thank you. Next question. Why this role?');
    await settle();
    expect(sources.map((s) => s.text)).toEqual(['Thank you.']);
    expect(fetched).toEqual(['Thank you.', 'Next question.']); // second requested before the first ends
    expect(p.getState().status).toBe('speaking');

    finish(0);
    await settle();
    finish(1);
    await settle();
    finish(2);
    expect(await done).toBe('done');
    expect(sources.map((s) => s.text)).toEqual(['Thank you.', 'Next question.', 'Why this role?']);
    expect(p.getState().status).toBe('idle');
  });

  it('stops immediately and a new speak replaces the old one', async () => {
    const p = new SpeechPlayer();
    const first = p.speak('One. Two. Three.');
    await settle();
    const second = p.speak('Other.');
    expect(await first).toBe('stopped');
    await settle();
    expect(sources.at(-1)!.text).toBe('Other.');
    finish(sources.length - 1);
    expect(await second).toBe('done');
    expect(sources.some((s) => s.text === 'Two.')).toBe(false);
  });

  it('reports a blocked start instead of throwing, and repeat() retries', async () => {
    resumeWorks = false;
    const p = new SpeechPlayer();
    expect(await p.speak('Hello there.')).toBe('failed');
    expect(p.getState().status).toBe('blocked');

    resumeWorks = true; // the user clicked
    const again = p.repeat();
    await settle();
    finish(0);
    expect(await again).toBe('done');
    expect(sources[0]!.text).toBe('Hello there.');
  });

  it('shows the server error and hint when synthesis fails', async () => {
    failText = 'Second.';
    const p = new SpeechPlayer();
    const done = p.speak('First. Second.');
    await settle();
    finish(0);
    expect(await done).toBe('failed');
    expect(p.getState()).toEqual({ status: 'error', message: 'Piper is down. Start it' });
  });

  it('notifies subscribers on every state change', async () => {
    const p = new SpeechPlayer();
    const seen: string[] = [];
    p.subscribe(() => seen.push(p.getState().status));
    const done = p.speak('Hi.');
    await settle();
    p.stop();
    await done;
    expect(seen).toEqual(['speaking', 'idle']);
  });
});
