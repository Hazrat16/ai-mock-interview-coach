import { useState } from 'react';
import { type ModelTestResult, modelTestResultSchema } from '@shared/schemas/llm';
import { Button } from '@/components/ui/button';
import { sendJson } from '@/lib/api';

/** Sends one small real request to a model and shows how long it took. */
export function ModelTestButton({ model }: { model: string }) {
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; result: ModelTestResult } | { kind: 'error'; text: string }
  >({ kind: 'idle' });

  const run = async () => {
    setState({ kind: 'running' });
    try {
      const result = await sendJson('POST', '/api/llm/test', { model }, modelTestResultSchema);
      setState({ kind: 'done', result });
    } catch (e) {
      setState({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" onClick={() => void run()} disabled={state.kind === 'running'}>
        {state.kind === 'running' ? 'Testing… (can take 30 s)' : 'Test'}
      </Button>
      <div role="status" className="text-xs">
        {state.kind === 'done' && (
          <p className="text-muted-foreground">
            Answered in {state.result.seconds} s
            {state.result.loadSeconds >= 1 && ` (incl. ${state.result.loadSeconds} s loading)`}, generating{' '}
            {state.result.outputTokensPerSec} tokens/s: “{state.result.question}”
          </p>
        )}
        {state.kind === 'error' && <p className="text-destructive">{state.text}</p>}
      </div>
    </div>
  );
}
