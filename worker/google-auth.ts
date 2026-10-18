import { z } from 'zod';
import { createSession, digest, emailVerificationStatements } from './auth';
import { ApiError } from './errors';
import { safeLocalPath } from './magic-link';
import type { Env, UserRow } from './types';

export const GOOGLE_STATE_COOKIE = 'cmv_google_state';
export const GOOGLE_STATE_AGE = 600;
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const encoder = new TextEncoder();
const b64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const randomValue = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const googleSignInInput = z.object({
  provider: z.literal('google'),
  callbackURL: z.string().max(2048).refine(safeLocalPath).default('/studio'),
}).strict();

export const googleOAuthEnabled = (env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) =>
  !!env.GOOGLE_CLIENT_ID?.trim() && !!env.GOOGLE_CLIENT_SECRET?.trim();

function requireGoogleConfig(env: Env) {
  if (!googleOAuthEnabled(env)) throw new ApiError(503, 'Google sign-in is not configured yet.', 'GOOGLE_UNAVAILABLE');
  let appUrl: URL;
  try { appUrl = new URL(env.APP_URL); } catch { throw new ApiError(503, 'Google sign-in is not configured yet.', 'GOOGLE_UNAVAILABLE'); }
  if (appUrl.protocol !== 'https:' && appUrl.hostname !== 'localhost' && appUrl.hostname !== '127.0.0.1') {
    throw new ApiError(503, 'Google sign-in is not configured yet.', 'GOOGLE_UNAVAILABLE');
  }
  return appUrl;
}

export async function beginGoogleOAuth(env: Env, callbackPath: string, now = Math.floor(Date.now() / 1000)) {
  const appUrl = requireGoogleConfig(env);
  if (!safeLocalPath(callbackPath)) throw new ApiError(400, 'Choose a page on this website to return to.', 'INVALID_CALLBACK');
  const state = randomValue();
  const verifier = randomValue(48);
  const nonce = randomValue();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
  const stateHash = await digest(state);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM google_oauth_states WHERE expires_at<=?').bind(now),
    env.DB.prepare('INSERT INTO google_oauth_states (state_hash,code_verifier,nonce,callback_path,expires_at,created_at) VALUES (?,?,?,?,?,?)')
      .bind(stateHash, verifier, nonce, callbackPath, now + GOOGLE_STATE_AGE, now),
  ]);

  const redirectUri = new URL('/api/auth/google/callback', appUrl).href;
  const authorization = new URL(GOOGLE_AUTHORIZE_URL);
  authorization.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'online',
  }).toString();
  return { state, url: authorization.href };
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function decodeJwtPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

interface GoogleUserInfo { sub: string; email: string; email_verified: boolean; hd?: string; }
interface GoogleIdClaims { iss: string; aud: string; sub: string; email: string; email_verified: boolean; nonce: string; exp: number; iat: number; hd?: string; }

async function validateGoogleIdToken(idToken: string, env: Env, expectedNonce: string, now: number): Promise<GoogleIdClaims> {
  const invalid = () => new ApiError(400, 'Google sign-in could not be verified. Please start again.', 'GOOGLE_ID_TOKEN_INVALID');
  const parts = idToken.split('.');
  if (parts.length !== 3 || idToken.length > 16_384) throw invalid();
  let header: { alg?: string; kid?: string };
  let claims: Partial<GoogleIdClaims>;
  try { header = decodeJwtPart(parts[0]); claims = decodeJwtPart(parts[1]); }
  catch { throw invalid(); }
  if (header.alg !== 'RS256' || !header.kid || header.kid.length > 256) throw invalid();
  let response: Response;
  try { response = await fetch(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' } }); }
  catch { throw new ApiError(503, 'Google sign-in could not be completed. Please try again.', 'GOOGLE_KEYS_UNAVAILABLE'); }
  if (!response.ok) throw new ApiError(503, 'Google sign-in could not be completed. Please try again.', 'GOOGLE_KEYS_UNAVAILABLE');
  const keySet = await response.json().catch(() => null) as { keys?: Array<JsonWebKey & { kid?: string; use?: string; alg?: string }> } | null;
  const jwk = keySet?.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig' && key.alg === 'RS256');
  if (!jwk) throw invalid();
  let signatureValid = false;
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    signatureValid = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, decodeBase64Url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  } catch { throw invalid(); }
  const audienceIsClient = claims.aud === env.GOOGLE_CLIENT_ID;
  if (!signatureValid || !audienceIsClient ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss ?? '') ||
      typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now + 300 ||
      claims.nonce !== expectedNonce || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 ||
      claims.email_verified !== true || typeof claims.email !== 'string') throw invalid();
  const parsedEmail = emailSchema.safeParse(claims.email);
  if (!parsedEmail.success) throw invalid();
  if (claims.hd !== undefined && (typeof claims.hd !== 'string' || !/^[a-z0-9.-]{1,253}$/i.test(claims.hd))) throw invalid();
  return { ...claims as GoogleIdClaims, email: parsedEmail.data };
}

async function fetchGoogleUserInfo(code: string, verifier: string, nonce: string, env: Env, redirectUri: string, now: number) {
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
  } catch { throw new ApiError(503, 'Google sign-in could not be completed. Please try again.', 'GOOGLE_EXCHANGE_FAILED'); }
  if (!tokenResponse.ok) throw new ApiError(400, 'Google sign-in could not be verified. Please start again.', 'GOOGLE_EXCHANGE_FAILED');
  const token = await tokenResponse.json().catch(() => null) as { access_token?: unknown; token_type?: unknown; id_token?: unknown } | null;
  if (typeof token?.access_token !== 'string' || !token.access_token || token.access_token.length > 8192 ||
      typeof token.id_token !== 'string' || (typeof token.token_type === 'string' && token.token_type.toLowerCase() !== 'bearer')) {
    throw new ApiError(400, 'Google sign-in could not be verified. Please start again.', 'GOOGLE_EXCHANGE_FAILED');
  }
  const claims = await validateGoogleIdToken(token.id_token, env, nonce, now);

  let userResponse: Response;
  try {
    userResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
    });
  } catch { throw new ApiError(503, 'Google sign-in could not be completed. Please try again.', 'GOOGLE_PROFILE_FAILED'); }
  if (!userResponse.ok) throw new ApiError(400, 'Google sign-in could not be verified. Please start again.', 'GOOGLE_PROFILE_FAILED');
  const raw = await userResponse.json().catch(() => null) as Partial<GoogleUserInfo> | null;
  const profile = z.object({ sub: z.string().min(1).max(255), email: emailSchema, email_verified: z.literal(true) }).safeParse(raw);
  if (!profile.success) throw new ApiError(400, 'Google must provide a verified email address to sign in.', 'GOOGLE_EMAIL_UNVERIFIED');
  if (profile.data.sub !== claims.sub || profile.data.email !== claims.email) throw new ApiError(400, 'Google sign-in could not be verified. Please start again.', 'GOOGLE_PROFILE_MISMATCH');
  return { ...profile.data, ...(claims.hd ? { hd: claims.hd.toLowerCase() } : {}) };
}

async function findOrCreateGoogleUser(env: Env, profile: GoogleUserInfo, now: number) {
  const linked = await env.DB.prepare(`SELECT users.* FROM oauth_identities
    JOIN users ON users.id=oauth_identities.user_id WHERE oauth_identities.provider='google' AND oauth_identities.provider_subject=?`)
    .bind(profile.sub).first<UserRow>();
  if (linked) return linked;

  const domain = profile.email.split('@')[1]?.toLowerCase();
  const trustedEmail = domain === 'gmail.com' || domain === 'googlemail.com' || (profile.hd && profile.hd === domain);
  if (!trustedEmail) {
    throw new ApiError(400, 'This Google email needs verification first. Return to sign in and choose the email link option.', 'GOOGLE_EMAIL_NEEDS_VERIFICATION');
  }

  let user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(profile.email).first<UserRow>();
  if (!user) {
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)')
        .bind(id, profile.email, `oauth_google_pending$${randomValue()}`, new Date(now * 1000).toISOString()).run();
    } catch (error) {
      if (!String(error).includes('UNIQUE')) throw error;
    }
    user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(profile.email).first<UserRow>();
  }
  if (!user) throw new Error('Google account was not created');
  await env.DB.prepare(`INSERT INTO oauth_identities (provider,provider_subject,user_id,created_at)
    VALUES ('google',?,?,?) ON CONFLICT(provider,provider_subject) DO NOTHING`)
    .bind(profile.sub, user.id, now).run();
  const identity = await env.DB.prepare(`SELECT users.* FROM oauth_identities
    JOIN users ON users.id=oauth_identities.user_id WHERE oauth_identities.provider='google' AND oauth_identities.provider_subject=?`)
    .bind(profile.sub).first<UserRow>();
  if (!identity) throw new Error('Google identity was not linked');
  return identity;
}

export async function completeGoogleOAuth(
  env: Env,
  input: { code: string; state: string; cookieState?: string },
  now = Math.floor(Date.now() / 1000),
) {
  const invalid = () => new ApiError(400, 'This Google sign-in has expired or is invalid. Please start again.', 'GOOGLE_STATE_INVALID');
  const appUrl = requireGoogleConfig(env);
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.state) || !input.cookieState || input.cookieState !== input.state ||
      typeof input.code !== 'string' || input.code.length < 1 || input.code.length > 2048) throw invalid();
  const stateHash = await digest(input.state);
  const row = await env.DB.prepare('SELECT code_verifier,nonce,callback_path FROM google_oauth_states WHERE state_hash=? AND expires_at>? AND consumed_at IS NULL')
    .bind(stateHash, now).first<{ code_verifier: string; nonce: string; callback_path: string }>();
  if (!row || !safeLocalPath(row.callback_path)) throw invalid();
  const consumed = await env.DB.prepare('UPDATE google_oauth_states SET consumed_at=? WHERE state_hash=? AND expires_at>? AND consumed_at IS NULL')
    .bind(now, stateHash, now).run();
  if (!consumed.meta.changes) throw invalid();

  const profile = await fetchGoogleUserInfo(input.code, row.code_verifier, row.nonce, env, new URL('/api/auth/google/callback', appUrl).href, now);
  const user = await findOrCreateGoogleUser(env, profile, now);
  if (user.email_verified_at === null) await env.DB.batch(await emailVerificationStatements(env.DB, user.email, now));
  const session = await createSession(env.DB, user.id, now);
  await env.DB.prepare('DELETE FROM google_oauth_states WHERE expires_at<=? OR consumed_at IS NOT NULL').bind(now).run();
  return { user, session, redirect: row.callback_path };
}
