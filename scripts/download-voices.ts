// Downloads the Piper voices in shared/voices.ts into $MODELS_DIR/piper (internet, one-time).
// Files come from a pinned commit and the model is checked by SHA-256 before it is kept.
// Existing complete files are left alone; nothing is deleted.
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VOICES, VOICES_REVISION } from '../shared/voices';
import { downloadVerified, fetchText, isComplete, modelsDir } from './lib/download';

const dir = join(modelsDir(), 'piper');
await mkdir(dir, { recursive: true });
const base = `https://huggingface.co/rhasspy/piper-voices/resolve/${VOICES_REVISION}`;
const wanted = process.argv.slice(2);

for (const v of VOICES.filter((voice) => wanted.length === 0 || wanted.includes(voice.id))) {
  const onnx = join(dir, `${v.id}.onnx`);
  if (isComplete(onnx, v.onnxBytes) && existsSync(`${onnx}.json`)) {
    console.log(`  ok    ${v.id} (already downloaded)`);
    continue;
  }
  console.log(`  get   ${v.id} (${Math.round(v.onnxBytes / 1e6)} MB, dataset: ${v.datasetLicense})`);
  const card = await fetchText(`${base}/${v.repoPath}/MODEL_CARD`);
  console.log(`        MODEL_CARD license line: ${card.match(/License:\s*(.+)/)?.[1] ?? '(none found)'}`);
  await downloadVerified(`${base}/${v.repoPath}/${v.id}.onnx`, onnx, v.onnxSha256);
  await writeFile(`${onnx}.json`, await fetchText(`${base}/${v.repoPath}/${v.id}.onnx.json`));
  await writeFile(join(dir, `${v.id}.MODEL_CARD.md`), card);
  console.log(`  done  ${v.id} (sha256 verified)`);
}

const present = VOICES.filter((v) => existsSync(join(dir, `${v.id}.onnx`)));
const mb = Math.round(present.reduce((sum, v) => sum + statSync(join(dir, `${v.id}.onnx`)).size, 0) / 1e6);
console.log(`Voices in ${dir}: ${present.map((v) => v.id).join(', ')} (${mb} MB)`);
