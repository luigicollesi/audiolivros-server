// src/tts/providers/speechify.provider.ts
import { Readable } from 'stream';

// usa global fetch (Node 18+) ou node-fetch (Node < 18)
let _fetch: typeof fetch;
try { /* @ts-ignore */ _fetch = fetch; } catch { _fetch = require('node-fetch'); }

function toNodeReadable(body: any): Readable {
  if (body && typeof (body as any).pipe === 'function') return body as unknown as Readable; // node-fetch
  // @ts-ignore
  if (Readable.fromWeb) return Readable.fromWeb(body as any); // Node 18 ReadableStream
  throw new Error('Readable.fromWeb indisponível (atualize Node ou use node-fetch).');
}

export type SpeechifyParams = {
  text: string;           // texto a ser lido
  voice: string;          // voice_id (obrigatório pela API)
  format?: string;        // "audio/mpeg" | "audio/ogg" | "audio/aac"
  signal?: AbortSignal;   // opcional: cancelamento externo
};

export class SpeechifyProvider {
  constructor(
    private readonly apiKey: string,
    private readonly defaultFormat: string = 'audio/mpeg',
  ) {}

  async stream({ text, voice, format, signal }: SpeechifyParams): Promise<Readable> {
    if (!this.apiKey) throw new Error('SPEECHIFY_API_KEY ausente');
    if (!voice?.trim()) throw new Error('voice_id ausente');
    if (!text?.trim()) throw new Error('texto vazio');

    const url = 'https://api.sws.speechify.com/v1/audio/stream';
    const accept = format || this.defaultFormat;

    // payload mínimo exigido pela API
    const body = { input: text, voice_id: voice.trim() };

    // timeout simples (12s) + composição com signal externo (se houver)
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), 12_000);
    const composed = composeSignals(signal, timeoutCtrl.signal);

    let resp: any;
    try {
      resp = await _fetch(url, {
        method: 'POST',
        // @ts-ignore
        signal: composed,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': accept,
        },
        body: JSON.stringify(body),
      } as any);
    } finally {
      clearTimeout(timer);
    }

    if (!resp?.ok || !resp.body) {
      const msg = await safeText(resp);
      throw new Error(`Speechify falhou: ${resp?.status} ${resp?.statusText ?? ''} ${msg ? '- ' + msg : ''}`.trim());
    }

    return toNodeReadable(resp.body);
  }
}

/** combina dois AbortSignals (externo + timeout) no mais simples possível */
function composeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a && !b) return undefined;
  if (a && !b) return a;
  if (!a && b) return b;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  a!.addEventListener('abort', onAbort, { once: true });
  b!.addEventListener('abort', onAbort, { once: true });
  return ctrl.signal;
}

async function safeText(resp?: any) {
  try { return await resp.text(); } catch { return ''; }
}
