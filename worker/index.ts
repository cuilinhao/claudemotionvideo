import { app } from './app';
import { refillAnnualSubscribers } from './billing';
import { recoverStaleJobs } from './workflow-runner';
import { recoverStaleSpeech } from './audio';
import type { Env } from './types';
import { applyPageSeo } from './seo';
import { siteAssetPath } from './site-routes';
export { GenerationWorkflow } from './workflow';

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname === 'www.cmotionvideo.com') {
      url.hostname = 'cmotionvideo.com'; url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, context);
    if (url.pathname === '/refund' || url.pathname === '/refund/') {
      url.pathname = '/refunds'; return Response.redirect(url.toString(), 301);
    }
    const assetUrl = new URL(url);
    assetUrl.pathname = siteAssetPath(url.pathname);
    const response = await applyPageSeo(await env.ASSETS.fetch(new Request(assetUrl, request)), url);
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'DENY');
    // A sandboxed srcdoc must not navigate itself to an external origin with image data.
    headers.set('Content-Security-Policy', "frame-src 'self'; object-src 'none'; base-uri 'self'");
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(Promise.all([
      refillAnnualSubscribers(env), recoverStaleJobs(env), recoverStaleSpeech(env),
      env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Math.floor(Date.now() / 1000)),
        env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(Math.floor(Date.now() / 1000)),
        env.DB.prepare('DELETE FROM password_resets WHERE expires_at<=? OR consumed_at IS NOT NULL').bind(Math.floor(Date.now() / 1000)),
        env.DB.prepare('DELETE FROM magic_links WHERE expires_at<=? OR consumed_at IS NOT NULL').bind(Math.floor(Date.now() / 1000)),
        env.DB.prepare('DELETE FROM google_oauth_states WHERE expires_at<=? OR consumed_at IS NOT NULL').bind(Math.floor(Date.now() / 1000)),
      ]),
    ]));
  },
} satisfies ExportedHandler<Env>;
