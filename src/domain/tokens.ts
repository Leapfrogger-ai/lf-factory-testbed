import { randomBytes } from 'node:crypto';

export function isToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
