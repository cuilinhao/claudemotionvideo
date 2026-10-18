import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, type User } from './lib/api';

export function Brand() {
  return <a className="logo" href="/" aria-label="Claude Motion Video home"><img className="logo-mark" src="/favicon.svg" alt="" aria-hidden="true" /><span className="logo-word">Claude Motion Video</span></a>;
}

export function AccountMenu({user, onAuth, onLogout}: {user: User | null; onAuth: () => void; onLogout: () => void}) {
  const paid = ['starter','pro','max'].includes(user?.plan ?? '');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('click', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', key); };
  }, []);
  return <div className="acct" ref={root}>
    {user ? <><a className="credits-pill" href="/account" title={`${user.credits.toLocaleString('en-US')} credits`} aria-label={`${user.credits.toLocaleString('en-US')} credits`}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 2 4 13.5h7l-1.5 8.5L19 10.5h-7z" /></svg>{user.credits.toLocaleString('en-US')}</a>
      <button type="button" className="avatar" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)}>{user.email.charAt(0).toUpperCase()}</button>
      {open && <div className="acct-menu" role="menu"><div className="acct-who"><b>{user.email.split('@')[0]}</b><span className="muted">{user.email}</span><span className="muted">{paid ? `${user.plan!.charAt(0).toUpperCase()}${user.plan!.slice(1)} plan` : 'No plan yet'}</span></div><a role="menuitem" href="/my-videos">My videos</a><a role="menuitem" href="/account">Account and credits</a>{!paid && <a role="menuitem" href="/pricing">Choose a plan</a>}<button role="menuitem" type="button" onClick={() => {setOpen(false); onLogout();}}>Sign out</button></div>}
    </> : <button type="button" className="btn small" onClick={onAuth}>Sign in</button>}
  </div>;
}

export function FidelityHeader({user, onAuth, onLogout}: {user: User | null; onAuth: () => void; onLogout: () => void}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    document.addEventListener('click', close); return () => document.removeEventListener('click', close);
  }, []);
  return <header className="top"><div className="wrap"><Brand /><nav className="nav"><a href="/studio">Studio</a><a href="/pricing">Pricing</a><a href="/blogs">Blogs</a></nav><div className="top-actions"><AccountMenu user={user} onAuth={onAuth} onLogout={onLogout} /></div><details className="mnav" ref={menu}><summary aria-label="Menu"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg></summary><nav className="mnav-list"><a href="/studio">Studio</a><a href="/pricing">Pricing</a><a href="/blogs">Blogs</a></nav></details></div></header>;
}

export function FidelityFooter() {
  const scenes = [['launch','App launch video'],['ui-demo','Product walkthrough'],['game','Mobile game ad'],['ecommerce','Flash-sale ad'],['social','Social ad 9:16'],['poster','Poster come alive'],['logo','Logo reveal'],['data','Data story']];
  const resources = [['/studio','Studio'],['/examples','Examples'],['/effects','Effects'],['/opus-5-5-video-generator','Opus 5.5 video generator'],['/pricing','Pricing'],['/blogs','Blogs'],['/featured','Featured on'],['/contact','Contact']];
  return <footer className="foot"><div className="wrap foot-top"><div className="foot-brand"><Brand /><p>The AI motion video editor you talk to.</p></div><nav className="foot-col" aria-label="Make"><p className="foot-title">Make</p>{scenes.map(([id,name]) => <a key={id} href="/studio" onClick={() => {try {sessionStorage.setItem('cmv.scene',id);} catch {/* storage may be unavailable */}}}>{name}</a>)}</nav><nav className="foot-col" aria-label="Resources"><p className="foot-title">Resources</p>{resources.map(([href,name]) => <a key={href} href={href}>{name}</a>)}</nav><nav className="foot-col" aria-label="Legal"><p className="foot-title">Legal</p><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/refunds">Refund Policy</a></nav></div><div className="wrap foot-bottom"><p>© 2026 Claude Motion Video · <a href="mailto:cuilinhao2015@gmail.com">cuilinhao2015@gmail.com</a></p></div></footer>;
}

export function FidelityLayout({user,onAuth,onLogout,children}: {user: User | null; onAuth: () => void; onLogout: () => void; children: ReactNode}) {
  return <><FidelityHeader user={user} onAuth={onAuth} onLogout={onLogout}/>{children}<FidelityFooter /></>;
}

export function SupportChat({user}: {user: User | null}) {
  const [open, setOpen] = useState(false);
  const [email,setEmail] = useState(user?.email ?? '');
  const [body,setBody] = useState('');
  const [sent,setSent] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const touchedEmail = useRef(false);
  useEffect(() => { if (user?.email && !touchedEmail.current) setEmail(user.email); }, [user?.email]);
  useEffect(() => {
    const show = () => setOpen(true);
    const hash = () => {if (location.hash === '#chat') {show(); history.replaceState(null,'',location.pathname + location.search);}};
    hash(); addEventListener('hashchange',hash); addEventListener('cmv:support',show);
    return () => {removeEventListener('hashchange',hash);removeEventListener('cmv:support',show);};
  }, []);
  useEffect(() => { if (open) textarea.current?.focus(); }, [open]);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  async function submit(event?: FormEvent) {
    event?.preventDefault(); if (busy || !body.trim() || !valid) return;
    setBusy(true);setError('');
    try {await api.support(email.trim(),body.trim(),location.pathname);setSent(email.trim());setBody('');}
    catch (err) {setError(err instanceof Error ? err.message : "That didn't send. Check your connection and try again.");}
    finally {setBusy(false);}
  }
  return <div className="chat-dock">{open && <div className="chat-panel" role="dialog" aria-label="Send us a message"><div className="chat-head"><div><b>Send us a message</b><span>We'll get back to you by email, usually within a day.</span></div><button type="button" className="chat-x" aria-label="Close" onClick={() => setOpen(false)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>{sent ? <div className="chat-done"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg><b>Thanks, we got it.</b><p>We'll reply to <strong>{sent}</strong>. Check your spam folder if you don't see it.</p><button type="button" className="btn small" onClick={() => {setSent(''); requestAnimationFrame(() => textarea.current?.focus());}}>Send another message</button></div> : <form className="chat-form" onSubmit={submit}><label className="chat-label">Your email<input type="email" className="chat-email" placeholder="you@example.com" value={email} required autoComplete="email" onChange={event => {touchedEmail.current=true;setEmail(event.target.value);}} /></label><label className="chat-label chat-grow">Message<textarea ref={textarea} maxLength={2000} placeholder="A question, an idea, or something not working?" value={body} onChange={event => setBody(event.target.value)} onKeyDown={event => {if (event.key==='Enter'&&(event.metaKey||event.ctrlKey)) {event.preventDefault();void submit();}}} /></label>{error&&<p className="chat-error" role="alert">{error}</p>}<button type="submit" className="btn primary chat-submit" disabled={!body.trim()||!valid||busy}>{busy?'Sending…':'Send'}</button></form>}</div>}<button type="button" className="chat-fab" aria-label={open?'Close':'Send us a message'} aria-expanded={open} onClick={() => setOpen(!open)}><svg width={open?'20':'24'} height={open?'20':'24'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={open?'2.4':'2'} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={open?'M6 9l6 6 6-6':'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'} /></svg></button></div>;
}
