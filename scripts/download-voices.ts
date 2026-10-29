// Downloads the Piper voices in shared/voices.ts into $MODELS_DIR/piper (internet, one-time).
// Files come from a pinned commit and the model is checked by SHA-256 before it is kept.
// Existing complete files are left alone; nothing is deleted.
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VOICES, VOICES_REVISION } from '../shared/voices';

process.loadEnvFile('.env');
const dir = join(process.env.MODELS_DIR ?? '', 'piper');
if (!process.env.MODELS_DIR || !existsSync(process.env.MODELS_DIR)) {
  console.error(`MODELS_DIR (${process.env.MODELS_DIR}) not found. Is the drive mounted? Run: make setup`);
  process.exit(1);
}
await mkdir(dir, { recursive: true });

const base = `https://huggingface.co/rhasspy/piper-voices/resolve/${VOICES_REVISION}`;
const wanted = process.argv.slice(2);

async function fetchFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

for (const v of VOICES.filter((voice) => wanted.length === 0 || wanted.includes(voice.id))) {
  const onnx = join(dir, `${v.id}.onnx`);
  if (existsSync(onnx) && statSync(onnx).size === v.onnxBytes && existsSync(`${onnx}.json`)) {
    console.log(`  ok    ${v.id} (already downloaded)`);
    continue;
  }
  console.log(`  get   ${v.id} (${Math.round(v.onnxBytes / 1e6)} MB, dataset: ${v.datasetLicense})`);
  const card = (await fetchFile(`${base}/${v.repoPath}/MODEL_CARD`)).toString();
  console.log(`        MODEL_CARD license line: ${card.match(/License:\s*(.+)/)?.[1] ?? '(none found)'}`);
  const model = await fetchFile(`${base}/${v.repoPath}/${v.id}.onnx`);
  const sha = createHash('sha256').update(model).digest('hex');
  if (sha !== v.onnxSha256) throw new Error(`${v.id}: SHA-256 mismatch (got ${sha}); file not saved`);
  await writeFile(`${onnx}.part`, model);
  await rename(`${onnx}.part`, onnx);
  await writeFile(`${onnx}.json`, await fetchFile(`${base}/${v.repoPath}/${v.id}.onnx.json`));
  await writeFile(join(dir, `${v.id}.MODEL_CARD.md`), card);
  console.log(`  done  ${v.id} (sha256 verified)`);
}

const present = VOICES.filter((v) => existsSync(join(dir, `${v.id}.onnx`)));
const mb = Math.round(present.reduce((sum, v) => sum + statSync(join(dir, `${v.id}.onnx`)).size, 0) / 1e6);
console.log(`Voices in ${dir}: ${present.map((v) => v.id).join(', ')} (${mb} MB)`);
