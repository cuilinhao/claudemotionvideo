// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';

const roots = vi.hoisted(() => [] as Root[]);
vi.mock('react-dom/client', async importOriginal => {
  const original = await importOriginal<typeof import('react-dom/client')>();
  return { ...original, createRoot: (...args: Parameters<typeof original.createRoot>) => {
    const root = original.createRoot(...args); roots.push(root); return root;
  } };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const buyer = { id:'buyer', email:'buyer@example.com', credits:0, singleVideoGenerations:0, plan:'free', subscriptionStatus:null };
const session = (user: typeof buyer | null) => Response.json({ user, billingEnabled:true, singleVideoEnabled:true, providers:{email:true,google:false} });

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', { pathname:'/pricing', search:'', assign:vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {configurable:true, value:function(this:HTMLDialogElement) { this.open = true; }});
  document.body.innerHTML = '<button data-checkout="starter" data-interval="month">Get Starter</button><button data-checkout="max" data-interval="year">Get Max</button><button data-checkout="single-video">Buy one video</button><div id="cmv-account"></div>';
});
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()); });
  document.body.innerHTML = '';
  Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');
  vi.unstubAllGlobals();
});

async function openPage() {
  const sessions: ReturnType<typeof deferred<Response>>[] = [];
  const checkouts: {url:string; body:unknown; response:ReturnType<typeof deferred<Response>>}[] = [];
  vi.stubGlobal('fetch', (url:string, init?:RequestInit) => {
    if (url === '/api/me') { const response = deferred<Response>(); sessions.push(response); return response.promise; }
    if (url === '/api/auth/logout') return Promise.resolve(Response.json({ok:true}));
    if (url === '/api/auth/login') return Promise.resolve(Response.json({user:buyer}));
    if (url === '/api/billing/checkout' || url === '/api/billing/checkout-single-video') {
      const response = deferred<Response>();
      checkouts.push({url,body:init?.body ? JSON.parse(String(init.body)) : null,response});
      return response.promise;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  await act(async () => { await import('../src/reference-main'); });
  const click = async (selector:string) => { await act(async () => { document.querySelector<HTMLButtonElement>(selector)!.click(); }); };
  const resolveSession = async (index:number, user:typeof buyer|null) => { await act(async () => { sessions[index].resolve(session(user)); }); };
  return { sessions, checkouts, click, resolveSession };
}

async function signInWithPassword(page: Awaited<ReturnType<typeof openPage>>) {
  await page.click('.cmv-auth-options button');
  await act(async () => {
    for (const [id,value] of [['signin-email','buyer@example.com'],['signin-password','example-password']]) {
      const input = document.getElementById(id)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
  });
  await act(async () => { document.querySelector('form.signin-email')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); });
}

it.each([
  {selector:'[data-checkout="starter"]',url:'/api/billing/checkout',body:{plan:'starter',interval:'month'}},
  {selector:'[data-checkout="max"]',url:'/api/billing/checkout',body:{plan:'max',interval:'year'}},
  {selector:'[data-checkout="single-video"]',url:'/api/billing/checkout-single-video',body:null},
])('waits for the initial signed-in session before opening $selector checkout', async ({selector,url,body}) => {
  const page = await openPage();
  await page.click(selector);
  expect(document.querySelector('dialog[aria-label="Sign in"]')).toBeNull();
  expect(page.checkouts).toHaveLength(0);
  await page.resolveSession(0,buyer);
  expect(document.querySelector('dialog')).toBeNull();
  expect(page.checkouts).toHaveLength(1);
  expect(page.checkouts[0]).toMatchObject({url,body});
  await act(async () => { page.checkouts[0].response.resolve(Response.json({url:'https://checkout.stripe.com/test-session'})); });
  expect(location.assign).toHaveBeenCalledExactlyOnceWith('https://checkout.stripe.com/test-session');
});

it('opens sign-in only after the initial session confirms an anonymous visitor', async () => {
  const page = await openPage();
  await page.click('[data-checkout="starter"]');
  expect(document.querySelector('dialog')).toBeNull();
  await page.resolveSession(0,null);
  expect(document.querySelector('dialog[aria-label="Sign in"]')).not.toBeNull();
  expect(page.checkouts).toHaveLength(0);
});

it('resumes the selected checkout after an anonymous visitor signs in', async () => {
  const page = await openPage();
  await page.click('[data-checkout="max"]');
  await page.resolveSession(0,null);
  await page.resolveSession(1,null);
  await signInWithPassword(page);
  expect(document.querySelector('dialog')).toBeNull();
  expect(page.checkouts).toHaveLength(1);
  expect(page.checkouts[0].body).toEqual({plan:'max',interval:'year'});
});

it('opens the checkout query callback once after the latest session refresh resolves', async () => {
  vi.stubGlobal('location',{pathname:'/pricing',search:'?checkout=max&interval=year',assign:vi.fn()});
  const page = await openPage();
  await page.resolveSession(1,buyer);
  await page.resolveSession(0,null);
  expect(document.querySelector('dialog')).toBeNull();
  expect(page.checkouts).toHaveLength(1);
  expect(page.checkouts[0].body).toEqual({plan:'max',interval:'year'});
});

it('submits only once when checkout is clicked repeatedly while session loading and checkout are pending', async () => {
  const page = await openPage();
  await page.click('[data-checkout="starter"]');
  await page.click('[data-checkout="starter"]');
  await page.resolveSession(0,buyer);
  expect(page.checkouts).toHaveLength(1);
  await page.click('[data-checkout="starter"]');
  expect(page.checkouts).toHaveLength(1);
});

it('shows a retryable error instead of sign-in if the initial session request fails', async () => {
  const page = await openPage();
  await page.click('[data-checkout="starter"]');
  await act(async () => { page.sessions[0].reject(new Error('Network unavailable')); });
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toMatch(/try again/i);
  expect(page.checkouts).toHaveLength(0);
  await page.click('[data-checkout="max"]');
  expect(page.sessions).toHaveLength(2);
  await page.resolveSession(1,buyer);
  expect(page.checkouts).toHaveLength(1);
  expect(page.checkouts[0].body).toEqual({plan:'max',interval:'year'});
});

it('waits for the newer focus refresh when it supersedes the initial session request', async () => {
  const page = await openPage();
  await page.click('[data-checkout="starter"]');
  await act(async () => { dispatchEvent(new Event('focus')); });
  await page.resolveSession(0,buyer);
  expect(page.checkouts).toHaveLength(0);
  expect(document.querySelector('dialog')).toBeNull();
  await page.resolveSession(1,buyer);
  expect(page.checkouts).toHaveLength(1);
});

it('does not resume a checkout waiting for session refresh after sign-out', async () => {
  const page = await openPage();
  await page.resolveSession(0,buyer);
  await act(async () => { dispatchEvent(new Event('focus')); });
  await page.click('[data-checkout="starter"]');
  await page.click('[aria-label="Account menu"]');
  await page.click('button[role="menuitem"]');
  await page.resolveSession(1,buyer);
  expect(page.checkouts).toHaveLength(0);
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.querySelector('[aria-label="Account menu"]')).toBeNull();
});

it('allows a fresh checkout after sign-out without waiting for an obsolete session request', async () => {
  const page = await openPage();
  await page.resolveSession(0,buyer);
  await act(async () => { dispatchEvent(new Event('focus')); });
  await page.click('[data-checkout="starter"]');
  await page.click('[aria-label="Account menu"]');
  await page.click('button[role="menuitem"]');
  await page.click('[data-checkout="max"]');
  expect(document.querySelector('dialog[aria-label="Sign in"]')).not.toBeNull();
  expect(page.checkouts).toHaveLength(0);
});

it('keeps the new checkout locked when an older checkout finishes waiting after signing in again', async () => {
  const page = await openPage();
  await page.resolveSession(0,buyer);
  await act(async () => { dispatchEvent(new Event('focus')); });
  await page.click('[data-checkout="starter"]');
  await page.click('[aria-label="Account menu"]');
  await page.click('button[role="menuitem"]');
  await page.click('[data-checkout="max"]');
  expect(document.querySelector('dialog[aria-label="Sign in"]')).not.toBeNull();
  await page.resolveSession(2,null);
  await signInWithPassword(page);
  expect(page.checkouts).toHaveLength(1);
  expect(page.checkouts[0].body).toEqual({plan:'max',interval:'year'});
  await page.resolveSession(1,buyer);
  await page.click('[data-checkout="starter"]');
  expect(page.checkouts).toHaveLength(1);
});
