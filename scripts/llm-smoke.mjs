// LLM smoke test: for each model, a cold and a warm structured-JSON request via the Ollama HTTP API.
// Checks valid JSON, no thinking text, timings, memory, cloud disabled, port bound to localhost.
// Appends a report to docs/benchmarks/<date>-llm-smoke.md
import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';

process.loadEnvFile('.env');
const { OLLAMA_URL, INTERVIEWER_MODEL, EVALUATOR_MODEL, FALLBACK_MODEL, OLLAMA_IMAGE_TAG, OLLAMA_MEM_LIMIT } =
  process.env;
const models = [...new Set([INTERVIEWER_MODEL, EVALUATOR_MODEL, FALLBACK_MODEL])];

let fails = 0;
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m) => (fails++, console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`));
const info = (m) => console.log(`  ....  ${m}`);
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const prompt =
  'You are a job interviewer. Reply with a JSON object containing one behavioral interview question for a junior software engineer and the skill it tests.';
const schema = {
  type: 'object',
  properties: { question: { type: 'string' }, skill: { type: 'string' } },
  required: ['question', 'skill'],
};

async function api(path, body) {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

async function generate(model) {
  const body = { model, prompt, format: schema, stream: false, think: false, options: { temperature: 0.7 } };
  try {
    return await api('/api/generate', body);
  } catch (err) {
    if (!/think/i.test(err.message)) throw err;
    delete body.think; // model without a thinking mode
    return api('/api/generate', body);
  }
}

const sec = (ns) => (ns / 1e9).toFixed(2);
const rate = (count, ns) => (ns ? (count / (ns / 1e9)).toFixed(1) : '-');
const availGb = () => (os.freemem() / 1024 ** 3).toFixed(1);
const containerMem = () =>
  sh('docker stats --no-stream --format "{{.MemUsage}}" $(docker compose ps -q ollama)').split('/')[0].trim();

try {
  info(`Ollama ${(await api('/api/version')).version} at ${OLLAMA_URL}`);
} catch {
  console.error(`Ollama is not reachable at ${OLLAMA_URL}. Run: make deps-up`);
  process.exit(1);
}
const installed = (await api('/api/tags')).models.map((m) => m.name);
for (const m of models) {
  if (!installed.includes(m)) {
    console.error(`Model ${m} is not downloaded. Run: make models`);
    process.exit(1);
  }
}

const power =
  sh('cat /sys/class/power_supply/*/online 2>/dev/null | head -1') === '1' ? 'on AC' : 'on battery or unknown';
const rows = [];
const ramBefore = availGb();

for (const model of models) {
  console.log(`== ${model}`);
  await api('/api/generate', { model, keep_alive: 0 }); // unload, so the first run is cold
  for (const run of ['cold', 'warm']) {
    let r;
    try {
      r = await generate(model);
    } catch (err) {
      fail(`${model} (${run}): ${err.message}`);
      rows.push(`| ${model} | ${run} | error: ${err.message} | | | | | | |`);
      break;
    }
    let json = 'yes';
    try {
      JSON.parse(r.response);
      pass(`${model} (${run}): valid JSON`);
    } catch {
      json = 'no';
      fail(`${model} (${run}): response is not valid JSON`);
    }
    const thinking = r.thinking || /<think>/i.test(r.response) ? 'yes' : 'no';
    if (thinking === 'yes') fail(`${model} (${run}): thinking text in output`);
    else pass(`${model} (${run}): no thinking text`);
    const mem = containerMem();
    const promptRate = rate(r.prompt_eval_count, r.prompt_eval_duration);
    const genRate = rate(r.eval_count, r.eval_duration);
    info(
      `load ${sec(r.load_duration)}s, prompt ${r.prompt_eval_count} tok @ ${promptRate} tok/s, ` +
        `gen ${r.eval_count} tok @ ${genRate} tok/s, total ${sec(r.total_duration)}s, RAM ${mem}`,
    );
    info(`response: ${r.response.slice(0, 140)}`);
    rows.push(
      `| ${model} | ${run} | ${sec(r.load_duration)} s | ${r.prompt_eval_count} @ ${promptRate} | ` +
        `${r.eval_count} @ ${genRate} | ${sec(r.total_duration)} s | ${json} | ${thinking} | ${mem} |`,
    );
  }
  await api('/api/generate', { model, keep_alive: 0 }); // don't hold two models in memory
}

console.log('== privacy');
const logs = sh('docker compose logs ollama 2>&1');
const cloudOff = /cloud disabled: true/i.test(logs);
if (cloudOff) pass('Ollama log confirms cloud disabled');
else fail('Ollama log does not show "cloud disabled: true"');
const binding = sh('docker compose port ollama 11434');
if (binding.startsWith('127.0.0.1:')) pass(`port bound to this computer only (${binding})`);
else fail(`port exposed beyond localhost: ${binding}`);

const date = new Date().toISOString().slice(0, 10);
const report = `docs/benchmarks/${date}-llm-smoke.md`;
mkdirSync('docs/benchmarks', { recursive: true });
appendFileSync(
  report,
  [
    `# LLM smoke test, ${new Date().toLocaleString('sv-SE')}`,
    '',
    `- Ollama image: ollama/ollama:${OLLAMA_IMAGE_TAG}, memory limit ${OLLAMA_MEM_LIMIT}`,
    `- CPU: ${readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.*)/)[1]}`,
    `- Power: ${power}; RAM available before ${ramBefore} GB, after ${availGb()} GB`,
    '',
    '| model | run | load | prompt tokens @ tok/s | generated tokens @ tok/s | total | valid JSON | thinking text | container RAM |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `- Cloud disabled in log: ${cloudOff ? 'yes' : 'no'}; port binding: ${binding}`,
    '',
    '',
  ].join('\n'),
);
console.log(`\nReport appended to ${report}`);
process.exit(fails ? 1 : 0);
