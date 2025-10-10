export function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return Buffer.from(base64 + padding, 'base64').toString('utf8');
}
