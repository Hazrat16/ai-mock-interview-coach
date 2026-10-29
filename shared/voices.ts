/**
 * Piper voices the app offers. Each dataset license was read from the voice's MODEL_CARD on 2026-10-29
 * (record: docs/benchmarks/2026-10-29-tts.md). Voices with non-commercial datasets (lessac, ryan, hfc_*) are excluded.
 * Files come from huggingface.co/rhasspy/piper-voices (MIT) at a pinned commit and are checked by SHA-256.
 */
export const VOICES_REVISION = '5041a7a49ae5b3a0f30e6837769eb03fdbb231bd';

export const VOICE_IDS = [
  'en_US-ljspeech-medium',
  'en_US-ljspeech-high',
  'en_US-joe-medium',
  'en_US-norman-medium',
] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

export type VoiceInfo = {
  id: VoiceId;
  label: string;
  /** Folder in the piper-voices repository. */
  repoPath: string;
  datasetLicense: string;
  onnxSha256: string;
  onnxBytes: number;
};

export const VOICES: readonly VoiceInfo[] = [
  {
    id: 'en_US-ljspeech-medium',
    label: 'LJ (female, US)',
    repoPath: 'en/en_US/ljspeech/medium',
    datasetLicense: 'LJ Speech, public domain',
    onnxSha256: '6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22',
    onnxBytes: 63531379,
  },
  {
    id: 'en_US-ljspeech-high',
    label: 'LJ, high quality (female, US, slower)',
    repoPath: 'en/en_US/ljspeech/high',
    datasetLicense: 'LJ Speech, public domain',
    onnxSha256: '5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a',
    onnxBytes: 114199011,
  },
  {
    id: 'en_US-joe-medium',
    label: 'Joe (male, US)',
    repoPath: 'en/en_US/joe/medium',
    datasetLicense: 'OHF voice-datasets, CC0',
    onnxSha256: '58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06',
    onnxBytes: 63201294,
  },
  {
    id: 'en_US-norman-medium',
    label: 'Norman (male, US)',
    repoPath: 'en/en_US/norman/medium',
    datasetLicense: 'LibriVox, public domain',
    onnxSha256: 'b9739443232a80a59c7d18810dd856899bf16a7964725f5ab81ea49b1351cb71',
    onnxBytes: 63531379,
  },
];

export const DEFAULT_VOICE: VoiceId = 'en_US-ljspeech-medium';
