import { GuardedApiSituationUnderstandingProvider, RuleBasedSituationUnderstandingProvider, SituationProviderError } from './situation.ts';
import type { SituationUnderstandingTransport, SituationUnderstandingTransportRequest } from './situation.ts';

export interface BedrockSituationOptions {
  region: string;
  modelId: string;
  bearerToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// Server-only Converse adapter; no arbitrary base URL or browser credential.
export class BedrockSituationUnderstandingTransport implements SituationUnderstandingTransport {
  readonly #endpoint: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  constructor(options: BedrockSituationOptions) {
    if (!/^(us|eu|ap|ca|sa|me|af|il|mx)-[a-z]+-\d$/.test(options.region) ||
        !options.modelId || options.modelId.length > 2048 || /[\s/?#]/.test(options.modelId) ||
        !options.bearerToken || /[\r\n]/.test(options.bearerToken)) {
      throw new Error('Invalid Bedrock situation configuration');
    }
    this.#endpoint = `https://bedrock-runtime.${options.region}.amazonaws.com/model/${encodeURIComponent(options.modelId)}/converse`;
    this.#token = options.bearerToken;
    this.#fetch = options.fetchImpl ?? fetch;
  }
  async analyze(request: SituationUnderstandingTransportRequest): Promise<unknown> {
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST', redirect: 'error', signal: request.signal,
        headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          system: [{ text: request.instructions.join('\n') }],
          messages: [{ role: 'user', content: [{ text: JSON.stringify({ language: request.language, rawTranscript: request.text }) }] }],
          inferenceConfig: { maxTokens: 320, temperature: 0 },
        }),
      });
      if (!response.ok) { void response.body?.cancel(); throw new Error('upstream failed'); }
      // Bound the full response, including unexpected upstream payloads.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('empty response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 16384) { void reader.cancel(); throw new Error('response too large'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      if (body.stopReason !== 'end_turn' || body.output?.message?.role !== 'assistant') throw new Error('incomplete response');
      const content = body.output.message.content;
      if (!Array.isArray(content) || content.length !== 1 || typeof content[0]?.text !== 'string') throw new Error('invalid response');
      return JSON.parse(content[0].text);
    } catch {
      // Never propagate provider bodies, transcripts, endpoint or credentials to logs/UI.
      throw new SituationProviderError('Bedrock situation request failed');
    }
  }
}

export class BedrockSituationUnderstandingProvider extends GuardedApiSituationUnderstandingProvider {
  constructor(options: BedrockSituationOptions) {
    super({ transport: new BedrockSituationUnderstandingTransport(options), fallback: new RuleBasedSituationUnderstandingProvider(), timeoutMs: options.timeoutMs, provider: 'bedrock' });
  }
}

export function situationProviderFromEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const selected = env.CARE_OPS_SITUATION_PROVIDER?.trim() || 'rule_based';
  if (selected === 'rule_based') return new RuleBasedSituationUnderstandingProvider();
  if (selected !== 'bedrock') throw new Error('Invalid situation provider');
  return new BedrockSituationUnderstandingProvider({
    region: env.AWS_REGION?.trim() ?? '',
    modelId: env.CARE_OPS_BEDROCK_MODEL_ID?.trim() ?? '',
    bearerToken: env.AWS_BEARER_TOKEN_BEDROCK?.trim() ?? '',
    timeoutMs: env.CARE_OPS_SITUATION_TIMEOUT_MS === undefined ? undefined : Number(env.CARE_OPS_SITUATION_TIMEOUT_MS),
  });
}
