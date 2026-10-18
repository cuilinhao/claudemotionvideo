import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';

describe('Google sign-in client API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns actual provider availability from the session endpoint', async () => {
    const fetchMock = vi.fn(async () => Response.json({ user: null, billingEnabled: false, providers: { email: true, google: true } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.me()).resolves.toMatchObject({ providers: { email: true, google: true } });
  });

  it('posts the selected provider and explicit safe callback path to the server', async () => {
    const fetchMock = vi.fn(async () => Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=generated' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.socialSignIn('google', '/pricing?checkout=starter&interval=month')).resolves.toMatchObject({ url: expect.stringContaining('accounts.google.com') });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-in/social', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ provider: 'google', callbackURL: '/pricing?checkout=starter&interval=month' }),
    }));
  });
});
