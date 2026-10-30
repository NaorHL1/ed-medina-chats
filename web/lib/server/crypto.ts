import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for chat payloads. The key comes from ENCRYPTION_KEY (32 bytes, base64).
 * Output is `iv.tag.ciphertext`, all base64, so a stored value is self-contained.
 */
function key(): Buffer {
  const raw = process.env['ENCRYPTION_KEY'];
  if (!raw) throw new Error('Set ENCRYPTION_KEY (32 bytes, base64) before storing chats.');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes.');
  return buf;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}

export function open(sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64'));
  if (!iv || !tag || !body) throw new Error('Stored payload is malformed.');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** Stores only a hash of a bearer token, so a database leak does not leak live sessions. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
