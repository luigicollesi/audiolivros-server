const BEARER_RE = /^Bearer\s+(.+)$/i;

export function extractBearerToken(raw: string | string[] | undefined): string | null {
  const header = Array.isArray(raw) ? raw[0] : raw ?? '';
  const match = header.match(BEARER_RE);
  if (!match) return null;

  const token = match[1].trim().replace(/^"|"$/g, '');
  if (!token) return null;

  const lowered = token.toLowerCase();
  if (lowered === 'undefined' || lowered === 'null') return null;
  return token;
}

export function hasBearerPrefix(value: string | undefined): boolean {
  if (!value) return false;
  return BEARER_RE.test(value);
}
