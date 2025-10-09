import * as crypto from 'crypto';

/**
 * Gera um token opaco e seu hash correspondente.
 * Retorna tanto o valor em claro (para enviar ao cliente) quanto o hash (para persistir).
 */
export function generateOpaqueToken(bytes = 32): { clear: string; hash: string } {
  const clear = crypto.randomBytes(bytes).toString('base64url');
  const hash = hashToken(clear);
  return { clear, hash };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('base64');
}

export function addHoursIso(hours: number, from = new Date()): string {
  const expires = new Date(from);
  expires.setHours(expires.getHours() + hours);
  return expires.toISOString();
}

type JsonParser = (payload: any) => string | undefined;
type HeaderParser = (headers: Headers) => string | undefined;

interface TimeSourceConfig {
  url: string;
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  parseJson?: JsonParser;
  parseHeaders?: HeaderParser;
}

const TIME_SOURCES: TimeSourceConfig[] = [
  {
    url: 'https://www.google.com',
    method: 'HEAD',
    timeoutMs: 2000,
    parseHeaders: (headers) => headers.get('date') ?? undefined,
  },
  {
    url: 'https://www.cloudflare.com',
    method: 'HEAD',
    timeoutMs: 2000,
    parseHeaders: (headers) => headers.get('date') ?? undefined,
  },
];

async function fetchUtcNowFromSource(source: TimeSourceConfig): Promise<Date> {
  const controller = new AbortController();
  const timeoutMs = source.timeoutMs ?? 3000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(source.url, {
      method: source.method ?? 'GET',
      signal: controller.signal,
      headers: source.parseJson ? { Accept: 'application/json' } : undefined,
    });
    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }

    let isoString: string | undefined;
    if (source.parseJson) {
      const payload = await response.json();
      isoString = source.parseJson(payload);
    } else if (source.parseHeaders) {
      isoString = source.parseHeaders(response.headers);
    }

    if (!isoString) {
      throw new Error('Fonte não retornou timestamp.');
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.valueOf())) {
      throw new Error(`Timestamp inválido recebido: ${isoString}`);
    }
    return date;
  } finally {
    clearTimeout(timeout);
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Obtém horário UTC de múltiplas fontes confiáveis. Se todas falharem,
 * utiliza o relógio local como fallback.
 */
export async function utcTimestampPlusMinutes(minutes: number): Promise<string> {
  for (const source of TIME_SOURCES) {
    try {
      const baseDate = await fetchUtcNowFromSource(source);
      baseDate.setMinutes(baseDate.getMinutes() + minutes);
      return baseDate.toISOString();
    } catch (error) {
      console.warn(`[token-utils] Falha na fonte ${source.url}:`, error);
    }
  }

  console.warn('[token-utils] Todas as fontes de horário falharam; usando relógio local.');
  return addHoursIso(minutes / 60);
}
