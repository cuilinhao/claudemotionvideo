import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { AuthModal } from './AuthModal';
import { AccountMenu, SupportChat } from './FidelityChrome';
import { api, type User } from './lib/api';
import type { AuthMode, Plan } from './lib/ui-types';
import { trackPageView } from './lib/analytics';
import './fidelity-shared.css';
import './motion-theme.css';

type Checkout = {plan: Plan; interval: 'month' | 'year'} | { singleVideo: true };
const checkoutCallback = (choice: Checkout) => 'singleVideo' in choice ? '/pricing?checkout=single-video' : `/pricing?checkout=${choice.plan}&interval=${choice.interval}`;
function ReferenceApp() {
  const [user,setUser] = useState<User|null>(null);
  const [auth,setAuth] = useState<AuthMode|null>(null);
  const [pending,setPending] = useState<Checkout|null>(null);
  const [notice,setNotice] = useState('');
  const currentUser = useRef<User|null>(null);
  const mounted = useRef(false);
  const authEpoch = useRef(0);
  const refreshRequest = useRef(0);
  const logoutPending = useRef(false);
  const checkoutBusy = useRef(false);
  const configuration = useRef({billingEnabled:false,singleVideoEnabled:false});
  const noticeTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const notify = useCallback((message: string) => {setNotice(message);if (noticeTimer.current) clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setNotice(''),5000);},[]);
  const refresh = useCallback(async () => {
    if (!mounted.current || logoutPending.current) return null;
    const epoch = authEpoch.current, request = ++refreshRequest.current;
    try {
      const result = await api.me();
      if (!mounted.current || epoch !== authEpoch.current || request !== refreshRequest.current) return null;
      configuration.current = {billingEnabled: result.billingEnabled, singleVideoEnabled: result.singleVideoEnabled};
      currentUser.current = result.user;
      setUser(result.user);
      return result.user;
    } catch { return null; }
  },[]);
  const checkout = useCallback(async (choice: Checkout) => {
    if (!mounted.current || logoutPending.current || checkoutBusy.current) return;
    if (!currentUser.current) {setPending(choice);setAuth('login');return;}
    const enabled = 'singleVideo' in choice ? configuration.current.singleVideoEnabled : configuration.current.billingEnabled;
    if (!enabled) {notify('This checkout is being configured. Please try again later.');return;}
    checkoutBusy.current=true;notify('Opening secure checkout…');
    try {const result = 'singleVideo' in choice ? await api.checkoutSingleVideo() : await api.checkout(choice.plan,choice.interval);location.assign(result.url);}
    catch (err) {notify(err instanceof Error ? err.message : 'Checkout could not open. Please try again.');checkoutBusy.current=false;}
  },[notify]);
  useEffect(() => {
    mounted.current = true;
    void refresh();trackPageView(location.pathname);
    const focus=()=>{void refresh();};addEventListener('focus',focus);
    const click=(event: MouseEvent)=>{
      const button=(event.target as Element)?.closest<HTMLElement>('[data-checkout]');
      if (!button) return;
      const plan=button.dataset.checkout,interval=button.dataset.interval;
      if (plan==='single-video') {event.preventDefault();void checkout({singleVideo:true});return;}
      if ((plan==='starter'||plan==='pro'||plan==='max')&&(interval==='month'||interval==='year')) {event.preventDefault();void checkout({plan,interval});}
    };
    document.addEventListener('click',click);
    const signin=()=>setAuth('login');addEventListener('cmv:signin',signin);
    const parameters=new URLSearchParams(location.search),plan=parameters.get('checkout'),interval=parameters.get('interval');
    const choice: Checkout|null = plan==='single-video' ? {singleVideo:true} : (plan==='starter'||plan==='pro'||plan==='max')&&(interval==='month'||interval==='year') ? {plan,interval} : null;
    if (choice) {
      history.replaceState(null,'',location.pathname);
      const epoch = authEpoch.current;
      void refresh().then(()=>{
        if (mounted.current && epoch === authEpoch.current) void checkout(choice);
      });
    }
    return ()=>{
      mounted.current = false;
      authEpoch.current++;
      refreshRequest.current++;
      logoutPending.current = false;
      removeEventListener('focus',focus);removeEventListener('cmv:signin',signin);document.removeEventListener('click',click);if(noticeTimer.current)clearTimeout(noticeTimer.current);
    };
  },[checkout,refresh]);
  async function logout() {
    if (!mounted.current || logoutPending.current) return;
    const epoch = ++authEpoch.current;
    refreshRequest.current++;
    logoutPending.current = true;
    try {
      await api.logout();
      if (!mounted.current || epoch !== authEpoch.current) return;
      currentUser.current = null;
      setUser(null);
    } catch (err) {
      if (!mounted.current || epoch !== authEpoch.current) return;
      notify(err instanceof Error ? err.message : 'Could not sign out.');
      logoutPending.current = false;
      void refresh();
    } finally {
      if (epoch === authEpoch.current) logoutPending.current = false;
    }
  }
  const account=document.getElementById('cmv-account'),support=document.getElementById('cmv-support');
  return <>
    {account && createPortal(<AccountMenu user={user} onAuth={() => setAuth('login')} onLogout={() => void logout()} />, account)}
    {support && createPortal(<SupportChat user={user} />, support)}
    {auth && <AuthModal mode={auth} onMode={setAuth} onClose={() => { setAuth(null); setPending(null); }}
      onDone={next => {
        if (!mounted.current) return;
        authEpoch.current++;
        refreshRequest.current++;
        logoutPending.current = false;
        currentUser.current = next;
        setUser(next);
        if (pending) { const choice = pending; setPending(null); void checkout(choice); }
      }} callbackURL={pending ? checkoutCallback(pending) : undefined} />}
    {notice && <div className="cmv-notice" role="status">{notice}</div>}
  </>;
}
const mount = document.createElement('div');mount.id='cmv-reference-app';document.body.append(mount);createRoot(mount).render(<ReferenceApp/>);
