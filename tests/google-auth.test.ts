import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../worker/app';
import { createSession } from '../worker/auth';
import type { Env } from '../worker/types';
import { makeDb, seedUser } from './backend-db';

const origin = 'https://claudemotionvideo.com';
const clientId = 'client-id.apps.googleusercontent.com';
const encoder = new TextEncoder();
let signingKey: CryptoKey;
let signingJwk: JsonWebKey;
const b64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const encodeJson = (value: unknown) => b64url(encoder.encode(JSON.stringify(value)));
async function makeIdToken(nonce: string, profile: { sub: string; email: string }, claims: Record<string, unknown> = {}) {
  const header = encodeJson({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const payload = encodeJson({ iss: 'https://accounts.google.com', aud: clientId, sub: profile.sub, email: profile.email,
    email_verified: true, nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const signed = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, signingKey, encoder.encode(signed)));
  return `${signed}.${b64url(signature)}`;
}
async function googleFetch(nonce: string, profile: { sub: string; email: string; email_verified: boolean; hd?: string }, claims: Record<string, unknown> = {}) {
  const idToken = await makeIdToken(nonce, profile, claims);
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(String(init?.body));
      expect(params.get('client_id')).toBe(clientId);
      expect(params.get('client_secret')).toBe('test-client-secret');
      expect(params.get('code_verifier')).toBeTruthy();
      return Response.json({ access_token: 'short-lived-token', token_type: 'Bearer', id_token: idToken });
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer short-lived-token');
      return Response.json(profile);
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [signingJwk] });
    throw new Error(`Unexpected network request: ${url}`);
  });
}
describe('Google OAuth sign in', () => {
  let env: Env;
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => app.request(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const start = async (callbackURL = '/studio?scene=launch') => {
    const response = await request('/api/auth/sign-in/social', { provider: 'google', callbackURL });
    const body = await response.json() as { url?: string };
    const authorization = body.url ? new URL(body.url) : null;
    const cookie = response.headers.get('set-cookie')?.match(/^cmv_google_state=([^;]+)/)?.[1];
    return { response, authorization, cookie };
  };
  beforeEach(() => {
    const { db } = makeDb();
    env = { DB: db, APP_URL: origin, GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-client-secret' } as unknown as Env;
  });
  beforeAll(async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    signingKey = pair.privateKey;
    signingJwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key', use: 'sig', alg: 'RS256' };
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('creates a server-bound state and PKCE authorization request with a secure short-lived cookie', async () => {
    const { response, authorization, cookie } = await start();
    expect(response.status).toBe(200);
    expect(authorization?.origin).toBe('https://accounts.google.com');
    expect(authorization?.pathname).toBe('/o/oauth2/v2/auth');
    expect(authorization?.searchParams.get('response_type')).toBe('code');
    expect(authorization?.searchParams.get('scope')).toBe('openid email');
    expect(authorization?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization?.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization?.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization?.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/google/callback`);
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const header = response.headers.get('set-cookie')!;
    expect(header).toMatch(/HttpOnly/); expect(header).toMatch(/Secure/); expect(header).toMatch(/SameSite=Lax/i); expect(header).toMatch(/Max-Age=600/i);
    expect(await env.DB.prepare('SELECT state_hash,code_verifier,nonce,callback_path,expires_at FROM google_oauth_states').first()).toMatchObject({ callback_path: '/studio?scene=launch' });
  });

  it('exchanges a one-time code, trusts only verified Google userinfo, creates a local session and redirects safely', async () => {
    const { authorization, cookie } = await start();
    const state = authorization!.searchParams.get('state')!;
    const fetchMock = await googleFetch(authorization!.searchParams.get('nonce')!, { sub: 'google-subject-123', email: 'person@gmail.com', email_verified: true });
    vi.stubGlobal('fetch', fetchMock);
    const callback = await request(`/api/auth/google/callback?code=google-code&state=${state}`, undefined, { Cookie: `cmv_google_state=${cookie}` });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe(`${origin}/studio?scene=launch`);
    const sessionCookie = callback.headers.get('set-cookie')!;
    expect(sessionCookie).toContain('cmv_session=');
    expect(sessionCookie).toMatch(/HttpOnly/); expect(sessionCookie).toMatch(/Secure/); expect(sessionCookie).toMatch(/SameSite=Lax/i);
    expect(sessionCookie).toContain('cmv_google_state=');
    expect(await env.DB.prepare('SELECT email,email_verified_at FROM users').first()).toMatchObject({ email: 'person@gmail.com' });
    expect(await env.DB.prepare('SELECT provider,provider_subject FROM oauth_identities').first()).toEqual({ provider: 'google', provider_subject: 'google-subject-123' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM google_oauth_states').first('n')).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('links a verified Google identity to an existing account without changing password or balance', async () => {
    await seedUser(env.DB, 'existing', 40);
    await env.DB.prepare("UPDATE users SET email='existing@gmail.com',email_verified_at=1760000000 WHERE id='existing'").run();
    const originalPassword = await env.DB.prepare("SELECT password_hash FROM users WHERE id='existing'").first('password_hash');
    const { authorization, cookie } = await start();
    vi.stubGlobal('fetch', await googleFetch(authorization!.searchParams.get('nonce')!, { sub: 'same-email-google', email: 'existing@gmail.com', email_verified: true }));
    const response = await request(`/api/auth/google/callback?code=code&state=${authorization!.searchParams.get('state')}`, undefined, { Cookie: `cmv_google_state=${cookie}` });
    expect(response.status).toBe(302);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1);
    expect(await env.DB.prepare("SELECT password_hash FROM users WHERE id='existing'").first('password_hash')).toBe(originalPassword);
    expect(await env.DB.prepare("SELECT credits FROM users WHERE id='existing'").first('credits')).toBe(40);
    expect(await env.DB.prepare('SELECT user_id FROM oauth_identities').first('user_id')).toBe('existing');
  });

  it('invalidates a pre-hijacked unverified account and its old sessions when trusted Google ownership is proven', async () => {
    await seedUser(env.DB, 'pre-hijack', 35);
    await env.DB.prepare("UPDATE users SET email='pre-hijack@gmail.com' WHERE id='pre-hijack'").run();
    const attackerSession = await createSession(env.DB, 'pre-hijack');
    const oldPassword = await env.DB.prepare("SELECT password_hash FROM users WHERE id='pre-hijack'").first('password_hash');
    const { authorization, cookie } = await start();
    vi.stubGlobal('fetch', await googleFetch(authorization!.searchParams.get('nonce')!, { sub: 'real-google-owner', email: 'pre-hijack@gmail.com', email_verified: true }));
    const path = `/api/auth/google/callback?code=code&state=${authorization!.searchParams.get('state')}`;
    const response = await request(path, undefined, { Cookie: `cmv_google_state=${cookie}` });
    expect(response.status).toBe(302);
    const updated = await env.DB.prepare("SELECT password_hash,email_verified_at,credits FROM users WHERE id='pre-hijack'").first<{ password_hash: string; email_verified_at: number; credits: number }>();
    expect(updated?.password_hash).not.toBe(oldPassword);
    expect(updated?.email_verified_at).toBeTruthy();
    expect(updated?.credits).toBe(35);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(1);
    const oldSession = await request('/api/me', undefined, { Cookie: `cmv_session=${attackerSession}` });
    expect((await oldSession.json()).user).toBeNull();
  });

  it('only allows automatic Google email association for Gmail or a matching signed Workspace domain', async () => {
    const { authorization: thirdPartyAuthorization, cookie: thirdPartyCookie } = await start();
    vi.stubGlobal('fetch', await googleFetch(thirdPartyAuthorization!.searchParams.get('nonce')!, { sub: 'third-party-owner', email: 'person@example.org', email_verified: true }));
    const thirdParty = await request(`/api/auth/google/callback?code=code&state=${thirdPartyAuthorization!.searchParams.get('state')}`, undefined, { Cookie: `cmv_google_state=${thirdPartyCookie}` });
    expect(thirdParty.status).toBe(302);
    expect(thirdParty.headers.get('location')).toContain('google_error=email_link');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_identities').first('n')).toBe(0);

    const { authorization, cookie } = await start();
    vi.stubGlobal('fetch', await googleFetch(authorization!.searchParams.get('nonce')!, { sub: 'workspace-user', email: 'person@example.org', email_verified: true, hd: 'example.org' }, { hd: 'example.org' }));
    const workspace = await request(`/api/auth/google/callback?code=code&state=${authorization!.searchParams.get('state')}`, undefined, { Cookie: `cmv_google_state=${cookie}` });
    expect(workspace.status).toBe(302);
    expect(await env.DB.prepare('SELECT email FROM users').first('email')).toBe('person@example.org');
  });

  it('allows only one callback to consume a state when duplicate callbacks race', async () => {
    const { authorization, cookie } = await start();
    const nonce = authorization!.searchParams.get('nonce')!;
    vi.stubGlobal('fetch', await googleFetch(nonce, { sub: 'racing-google-user', email: 'race@gmail.com', email_verified: true }));
    const path = `/api/auth/google/callback?code=code&state=${authorization!.searchParams.get('state')}`;
    const results = await Promise.all([request(path, undefined, { Cookie: `cmv_google_state=${cookie}` }), request(path, undefined, { Cookie: `cmv_google_state=${cookie}` })]);
    expect(results.map(response => response.status)).toEqual([302, 302]);
    expect(results.map(response => response.headers.get('location')).filter(location => location?.includes('google_error=failed'))).toHaveLength(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(1);
  });

  it.each([
    ['wrong audience', { aud: 'another-client.apps.googleusercontent.com' }],
    ['wrong issuer', { iss: 'https://attacker.example' }],
    ['wrong nonce', { nonce: 'not-the-issued-nonce' }],
    ['expired token', { exp: Math.floor(Date.now() / 1000) - 1 }],
  ])('rejects a signed ID token with %s without creating a local account', async (_label, claims) => {
    const { authorization, cookie } = await start();
    const nonce = authorization!.searchParams.get('nonce')!;
    vi.stubGlobal('fetch', await googleFetch(nonce, { sub: 'claim-test-user', email: 'claim-test@gmail.com', email_verified: true }, claims));
    const response = await request(`/api/auth/google/callback?code=code&state=${authorization!.searchParams.get('state')}`, undefined, { Cookie: `cmv_google_state=${cookie}` });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('google_error=failed');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(0);
  });

  it('rejects a tampered Google ID token signature before requesting userinfo', async () => {
    const { authorization, cookie } = await start();
    const nonce = authorization!.searchParams.get('nonce')!;
    const parts = (await makeIdToken(nonce, { sub: 'tampered-user', email: 'tampered@gmail.com' })).split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'temporary', id_token: parts.join('.') });
      if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [signingJwk] });
      throw new Error(`Unexpected network request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(`/api/auth/google/callback?code=code&state=${authorization!.searchParams.get('state')}`, undefined, { Cookie: `cmv_google_state=${cookie}` });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('google_error=failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(0);
  });

  it('rejects missing or mismatched state cookie before contacting Google', async () => {
    const { authorization, cookie } = await start();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const state = authorization!.searchParams.get('state');
    const noCookie = await request(`/api/auth/google/callback?code=code&state=${state}`);
    expect(noCookie.status).toBe(302); expect(noCookie.headers.get('location')).toContain('google_error=failed');
    const mismatch = await request(`/api/auth/google/callback?code=code&state=${state}`, undefined, { Cookie: `cmv_google_state=${'0'.repeat(43)}` });
    expect(mismatch.status).toBe(302); expect(mismatch.headers.get('location')).toContain('google_error=failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookie).toBeTruthy();
  });

  it('rejects replayed, expired and unverified callbacks without creating sessions', async () => {
    const { authorization, cookie } = await start();
    const state = authorization!.searchParams.get('state')!;
    vi.stubGlobal('fetch', await googleFetch(authorization!.searchParams.get('nonce')!, { sub: 'unverified', email: 'person@gmail.com', email_verified: false }));
    const path = `/api/auth/google/callback?code=code&state=${state}`;
    const unverified = await request(path, undefined, { Cookie: `cmv_google_state=${cookie}` });
    expect(unverified.status).toBe(302); expect(unverified.headers.get('location')).toContain('google_error=failed');
    const replay = await request(path, undefined, { Cookie: `cmv_google_state=${cookie}` });
    expect(replay.status).toBe(302); expect(replay.headers.get('location')).toContain('google_error=failed');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(0);
  });

  it('rejects a state after ten minutes before exchanging the Google code', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    const { authorization, cookie } = await start();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    vi.setSystemTime(new Date('2026-10-18T00:10:00Z'));
    const response = await request(`/api/auth/google/callback?code=code&state=${authorization!.searchParams.get('state')}`, undefined, { Cookie: `cmv_google_state=${cookie}` });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('google_error=failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(0);
  });

  it('only advertises Google when both OAuth credentials are configured', async () => {
    expect((await (await request('/api/me')).json()).providers.google).toBe(true);
    env.GOOGLE_CLIENT_SECRET = undefined;
    expect((await (await request('/api/me')).json()).providers.google).toBe(false);
    expect((await request('/api/auth/sign-in/social', { provider: 'google' })).status).toBe(503);
  });

  it('rejects unsafe callback paths and unsupported providers', async () => {
    for (const callbackURL of ['https://evil.test', '//evil.test', '/%2f%2fevil.test', '/\\evil.test']) {
      expect((await request('/api/auth/sign-in/social', { provider: 'google', callbackURL })).status).toBe(400);
    }
    expect((await request('/api/auth/sign-in/social', { provider: 'other' })).status).toBe(400);
  });
});
