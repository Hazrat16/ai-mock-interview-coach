// Downloads the Whisper models in shared/sttModels.ts into $MODELS_DIR/whisper (internet, one-time).
// Usage: npx tsx scripts/download-stt.ts [model ids...]   (default: all)
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { STT_MODELS, STT_MODELS_REVISION } from '../shared/sttModels';
import { downloadVerified, isComplete, modelsDir } from './lib/download';

const dir = join(modelsDir(), 'whisper');
await mkdir(dir, { recursive: true });
const wanted = process.argv.slice(2);
const base = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${STT_MODELS_REVISION}`;

for (const m of STT_MODELS.filter((model) => wanted.length === 0 || wanted.includes(model.id))) {
  const dest = join(dir, m.file);
  if (isComplete(dest, m.bytes)) {
    console.log(`  ok    ${m.id} (already downloaded)`);
    continue;
  }
  console.log(`  get   ${m.id} (${Math.round(m.bytes / 1e6)} MB)`);
  await downloadVerified(`${base}/${m.file}`, dest, m.sha256);
  console.log(`  done  ${m.id} (sha256 verified)`);
}
