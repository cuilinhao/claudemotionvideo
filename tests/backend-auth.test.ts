import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, allowedOrigin, rateLimit, createSession, getSessionUser } from '../worker/auth';
import { makeDb, seedUser } from './backend-db';

describe('account security', () => {
  it('uses unique salts and rejects a different password', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first).not.toBe(second);
    expect(await verifyPassword('correct horse battery staple', first)).toBe(true);
    expect(await verifyPassword('incorrect password', first)).toBe(false);
    expect(await verifyPassword('incorrect password', 'malformed')).toBe(false);
  });
  it('accepts exact origin only and rejects missing or lookalike origin on mutations', () => {
    expect(allowedOrigin('https://claudemotionvideo.com', 'https://claudemotionvideo.com')).toBe(true);
    expect(allowedOrigin('https://claudemotionvideo.com.evil.test', 'https://claudemotionvideo.com')).toBe(false);
    expect(allowedOrigin(null, 'https://claudemotionvideo.com')).toBe(false);
  });
  it('enforces a shared database rate limit and opens a fresh time window', async () => {
    const { db } = makeDb();
    expect(await rateLimit(db, 'ip', 2, 60, 100)).toBe(true);
    expect(await rateLimit(db, 'ip', 2, 60, 100)).toBe(true);
    expect(await rateLimit(db, 'ip', 2, 60, 100)).toBe(false);
    expect(await rateLimit(db, 'ip', 2, 60, 161)).toBe(true);
  });
  it('stores only a digest of session tokens and expires them', async () => {
    const { db } = makeDb(); await seedUser(db);
    const token = await createSession(db, 'alice', 100);
    const row = await db.prepare('SELECT token_hash FROM sessions').first<{ token_hash: string }>();
    expect(row!.token_hash).not.toBe(token);
    expect((await getSessionUser(db, token, 101))?.id).toBe('alice');
    expect(await getSessionUser(db, token, 100 + 31 * 86400)).toBeNull();
  });
});
