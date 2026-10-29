/** Minimal client for Ollama's /api/chat (non-streaming). */

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatOptions = {
  temperature?: number;
  num_ctx?: number;
  /** Maximum tokens to generate. */
  num_predict?: number;
  num_thread?: number;
  seed?: number;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  /** 'json' or a JSON schema the output must follow. */
  format?: 'json' | Record<string, unknown>;
  options?: ChatOptions;
  /** How long Ollama keeps the model loaded afterwards, e.g. '10m'; 0 unloads immediately. */
  keepAlive?: string | number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Timings in milliseconds, converted from Ollama's nanosecond fields. */
export type ChatMetrics = {
  totalMs: number;
  loadMs: number;
  promptTokens: number;
  promptMs: number;
  outputTokens: number;
  outputMs: number;
};

export type ChatResult = {
  content: string;
  /** 'stop' or 'length' (hit num_predict; output is probably cut off). */
  doneReason: string;
  metrics: ChatMetrics;
};

export class OllamaError extends Error {
  constructor(
    message: string,
    /** What the user can do about it, shown in the UI. */
    readonly hint?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class OllamaUnavailableError extends OllamaError {}
export class OllamaTimeoutError extends OllamaError {}
export class ModelMissingError extends OllamaError {}

const DEFAULT_TIMEOUT_MS = 120_000;
const ms = (ns: number | undefined) => Math.round((ns ?? 0) / 1e6);

type OllamaChatResponse = {
  message?: { content?: string };
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
};

export class OllamaClient {
  // Models that rejected `think: false` (no thinking mode); remembered so we don't retry every call.
  private readonly noThinkingMode = new Set<string>();

  constructor(private readonly baseUrl: string) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    try {
      return await this.send(req, !this.noThinkingMode.has(req.model));
    } catch (err) {
      if (err instanceof OllamaError && /does not support thinking/i.test(err.message)) {
        this.noThinkingMode.add(req.model);
        return this.send(req, false);
      }
      throw err;
    }
  }

  private async send(req: ChatRequest, disableThinking: boolean): Promise<ChatResult> {
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const signals = [AbortSignal.timeout(timeoutMs), ...(req.signal ? [req.signal] : [])];
    const body = {
      model: req.model,
      messages: req.messages,
      stream: false,
      format: req.format,
      options: req.options,
      keep_alive: req.keepAlive,
      // Thinking models (e.g. qwen3.5) would otherwise spend minutes reasoning on a CPU.
      ...(disableThinking ? { think: false } : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new OllamaTimeoutError(
          `${req.model} did not answer within ${Math.round(timeoutMs / 1000)} s`,
          'The computer may be busy or low on memory. Try again, or choose the smaller model in Settings.',
          { cause: err },
        );
      }
      if ((err as Error).name === 'AbortError') throw err;
      throw new OllamaUnavailableError(`Ollama is not reachable at ${this.baseUrl}`, 'Start it with: make deps-up', {
        cause: err,
      });
    }

    const json = (await res.json().catch(() => ({}))) as OllamaChatResponse;
    if (!res.ok) {
      const message = json.error ?? `Ollama returned HTTP ${res.status}`;
      if (res.status === 404 && /not found/i.test(message)) {
        throw new ModelMissingError(`Model ${req.model} is not downloaded`, `Download it with: make models`);
      }
      throw new OllamaError(message);
    }

    return {
      content: json.message?.content ?? '',
      doneReason: json.done_reason ?? 'stop',
      metrics: {
        totalMs: ms(json.total_duration),
        loadMs: ms(json.load_duration),
        promptTokens: json.prompt_eval_count ?? 0,
        promptMs: ms(json.prompt_eval_duration),
        outputTokens: json.eval_count ?? 0,
        outputMs: ms(json.eval_duration),
      },
    };
  }
}
