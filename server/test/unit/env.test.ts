import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/env';

describe('parseEnv', () => {
  it('applies loopback-only defaults', () => {
    const env = parseEnv({ DATA_DIR: '/tmp/coach' });
    expect(env).toMatchObject({ HOST: '127.0.0.1', PORT: 4317, OLLAMA_URL: 'http://127.0.0.1:11435' });
  });

  it('refuses to listen on all interfaces', () => {
    expect(() => parseEnv({ DATA_DIR: '/tmp/coach', HOST: '0.0.0.0' })).toThrow(/HOST/);
  });

  it('reports every problem in one error', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow(/PORT[\s\S]*DATA_DIR|DATA_DIR[\s\S]*PORT/);
  });
});
