import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AuthModal } from './AuthModal';
import { FidelityLayout, SupportChat } from './FidelityChrome';
import { AccountPage, MagicLinkPage } from './AccountPage';
import { MyVideosPage } from './MyVideosPage';
import { api, type User } from './lib/api';
import type { AuthMode } from './lib/ui-types';
import { StudioPage } from './Studio';

export default function App() {
  const [user,setUser] = useState<User|null>(null);
  const [authMode,setAuthMode] = useState<AuthMode|null>(null);
  const [notice,setNotice] = useState('');
  const [singleVideoEnabled,setSingleVideoEnabled] = useState(false);
  const [paymentRefreshing,setPaymentRefreshing] = useState(false);
  const mounted = useRef(false);
  const authEpoch = useRef(0);
  const refreshRequest = useRef(0);
  const logoutPending = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const location = useLocation();
  const refreshMe = useCallback(async () => {
    if (!mounted.current || logoutPending.current) return;
    const epoch = authEpoch.current, request = ++refreshRequest.current;
    try {
      const result = await api.me();
      if (mounted.current && epoch === authEpoch.current && request === refreshRequest.current) { setUser(result.user); setSingleVideoEnabled(result.singleVideoEnabled); }
    } catch { /* Keep the last known account when the session cannot be checked. */ }
  },[]);
  const openAuth = useCallback(() => setAuthMode('login'),[]);
  const signedIn = useCallback((next:User) => {
    if (!mounted.current) return;
    authEpoch.current++;
    refreshRequest.current++;
    logoutPending.current = false;
    setUser(next);
    void refreshMe();
  },[refreshMe]);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('billing') !== 'success') return;
    setPaymentRefreshing(true);
    let attempts = 0;
    const timer = setInterval(() => {
      void refreshMe();
      if (++attempts >= 15) { clearInterval(timer); setPaymentRefreshing(false); }
    }, 2000);
    return () => { clearInterval(timer); setPaymentRefreshing(false); };
  },[location.search,refreshMe]);
  useEffect(() => {
    mounted.current = true;
    void refreshMe();
    const focus=()=>void refreshMe();
    window.addEventListener('focus',focus);
    return()=>{
      mounted.current = false;
      authEpoch.current++;
      refreshRequest.current++;
      logoutPending.current = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      window.removeEventListener('focus',focus);
    };
  },[refreshMe]);
  useEffect(() => {
    document.body.classList.toggle('site-body',!location.pathname.startsWith('/studio'));
    function onKey(event:KeyboardEvent) {
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n'&&location.pathname.startsWith('/studio')){event.preventDefault();window.dispatchEvent(new Event('cmv:new-project'));}
    }
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[location.pathname]);
  useEffect(()=>{if(location.pathname==='/reset-password')setAuthMode('reset');},[location.pathname]);
  async function logout() {
    if (!mounted.current || logoutPending.current) return;
    const epoch = ++authEpoch.current;
    refreshRequest.current++;
    logoutPending.current = true;
    try {
      await api.logout();
      if (mounted.current && epoch === authEpoch.current) setUser(null);
    } catch (error) {
      if (!mounted.current || epoch !== authEpoch.current) return;
      setNotice(error instanceof Error ? error.message : 'Could not sign out.');
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(()=>setNotice(''),5000);
      logoutPending.current = false;
      void refreshMe();
    } finally {
      if (epoch === authEpoch.current) logoutPending.current = false;
    }
  }
  const layout=(children:React.ReactNode)=><FidelityLayout user={user} onAuth={openAuth} onLogout={()=>void logout()}>{children}</FidelityLayout>;
  const studio=<StudioPage user={user} onAuth={setAuthMode} onCredits={()=>void refreshMe()} onLogout={()=>void logout()}/>;
  return <>
    <Routes>
      <Route path="/studio" element={studio}/>
      <Route path="/studio/v/:id" element={studio}/>
      <Route path="/my-videos" element={layout(<MyVideosPage user={user} onAuth={openAuth}/>)}/>
      <Route path="/account" element={layout(<AccountPage user={user} onAuth={openAuth} singleVideoEnabled={singleVideoEnabled}/>)}/>
      <Route path="/sign-in" element={layout(<MagicLinkPage onDone={signedIn} onAuth={openAuth}/>)}/>
      <Route path="/reset-password" element={layout(<main className="wrap"><div className="page-head"><h1>Reset your password</h1><button className="btn primary" onClick={()=>setAuthMode('reset')}>Update password</button></div></main>)}/>
      <Route path="*" element={layout(<main className="wrap"><div className="page-head"><p className="mono muted">404</p><h1>Page not found</h1><p>This page doesn't exist. Head back to the Studio to make something new.</p><a className="btn primary" href="/">Back home</a></div></main>)}/>
    </Routes>
    {authMode&&<AuthModal mode={authMode} onMode={setAuthMode} onClose={()=>setAuthMode(null)} onDone={signedIn}/>}
    <SupportChat user={user}/>
    {notice&&<div className="cmv-notice" role="status">{notice}</div>}
    {paymentRefreshing&&!notice&&<div className="cmv-notice" role="status">Confirming your payment. Your balance refreshes automatically for up to 30 seconds.</div>}
  </>;
}
