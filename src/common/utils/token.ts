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
