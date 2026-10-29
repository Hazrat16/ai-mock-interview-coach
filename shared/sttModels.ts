/**
 * Whisper models for speech-to-text, in whisper.cpp's ggml format, from huggingface.co/ggerganov/whisper.cpp
 * (MIT; OpenAI's Whisper weights are MIT) at a pinned commit, checked by SHA-256. English-only (.en) models.
 * Measured in docs/benchmarks/2026-10-29-stt.md.
 */
export const STT_MODELS_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';

export const STT_MODEL_IDS = ['base.en', 'base.en-q5_1', 'small.en', 'small.en-q5_1'] as const;
export type SttModelId = (typeof STT_MODEL_IDS)[number];

export type SttModelInfo = { id: SttModelId; file: string; sha256: string; bytes: number };

export const STT_MODELS: readonly SttModelInfo[] = [
  {
    id: 'base.en',
    file: 'ggml-base.en.bin',
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    bytes: 147964211,
  },
  {
    id: 'base.en-q5_1',
    file: 'ggml-base.en-q5_1.bin',
    sha256: '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f',
    bytes: 59721011,
  },
  {
    id: 'small.en',
    file: 'ggml-small.en.bin',
    sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
    bytes: 487614201,
  },
  {
    id: 'small.en-q5_1',
    file: 'ggml-small.en-q5_1.bin',
    sha256: 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30',
    bytes: 190098681,
  },
];
