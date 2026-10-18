// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '../src/App';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('refreshes a delayed purchased generation after checkout and stops polling after 30 seconds', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  history.replaceState(null, '', '/account?billing=success');
  let sessionReads = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/api/me') {
      sessionReads++;
      return Response.json({user:{id:'buyer',email:'buyer@example.com',credits:0,singleVideoGenerations:sessionReads >= 3 ? 1 : 0,plan:'free',subscriptionStatus:null},billingEnabled:false,singleVideoEnabled:true,providers:{email:true,google:false}});
    }
    if (url === '/api/credits') return Response.json({credits:0,ledger:[]});
    throw new Error(`Unexpected request: ${url}`);
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<BrowserRouter><App /></BrowserRouter>));
    expect([...container.querySelectorAll('.number')].map(node => node.textContent)).toEqual(['0', '0']);
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect([...container.querySelectorAll('.number')].map(node => node.textContent)).toEqual(['0', '1']);
    await act(async () => vi.advanceTimersByTimeAsync(26000));
    const readsAfterConfirmationWindow = sessionReads;
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(sessionReads).toBe(readsAfterConfirmationWindow);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
