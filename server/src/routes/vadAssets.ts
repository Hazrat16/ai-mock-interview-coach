// Serves the browser's speech-detection files (Silero VAD + onnxruntime-web) from node_modules, so they never
// come from a CDN. Vite proxies /vad here in development; served directly in production. Only these files.
import { createReadStream, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';

const require = createRequire(import.meta.url);
// Resolved through each package's own entry points, so it works wherever node_modules is.
const vadDist = join(dirname(require.resolve('@ricky0123/vad-web/package.json')), 'dist');
const ort = (name: string) => require.resolve(`onnxruntime-web/${name}`); // listed in the package's "exports"

const FILES: Record<string, { path: string; type: string }> = {
  'vad.worklet.bundle.min.js': { path: join(vadDist, 'vad.worklet.bundle.min.js'), type: 'text/javascript' },
  'silero_vad_v5.onnx': { path: join(vadDist, 'silero_vad_v5.onnx'), type: 'application/octet-stream' },
  'ort-wasm-simd-threaded.wasm': { path: ort('ort-wasm-simd-threaded.wasm'), type: 'application/wasm' },
  'ort-wasm-simd-threaded.mjs': { path: ort('ort-wasm-simd-threaded.mjs'), type: 'text/javascript' },
};

export function vadAssetRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string } }>('/vad/:file', (req, reply) => {
    const file = FILES[req.params.file];
    if (!file) return reply.code(404).send({ error: 'Not found' });
    return reply
      .type(file.type)
      .header('content-length', statSync(file.path).size)
      .header('cache-control', 'public, max-age=86400') // versioned by package-lock; 17 MB, so cache it
      .send(createReadStream(file.path));
  });
}
