import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type User } from "./lib/api";
import type { AuthMode } from "./lib/ui-types";

export function AuthModal({ mode, onMode, onClose, onDone, callbackURL }: {
  mode: AuthMode;
  onMode: (mode: AuthMode) => void;
  onClose: () => void;
  onDone: (user: User) => void;
  callbackURL?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordLogin, setPasswordLogin] = useState(mode !== "login");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const magic = mode === "login" && !passwordLogin;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { setError(""); setPassword(""); setMessage(""); }, [mode, passwordLogin]);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const googleError = query.get('google_error');
    const messages: Record<string, string> = {
      email_link: 'Google can’t verify ownership of this email address. Use the email sign-in link below to verify it, then try again.',
      cancelled: 'Google sign-in was cancelled. You can try again or continue with email.',
      failed: 'Google sign-in could not be verified. Please try again, or use the email sign-in link.',
    };
    if (googleError && messages[googleError]) {
      setError(messages[googleError]);
      query.delete('google_error');
      const suffix = query.size ? `?${query.toString()}` : '';
      history.replaceState(null, '', `${location.pathname}${suffix}${location.hash}`);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void api.me().then(result => { if (active) setGoogleEnabled(result.providers.google); }).catch(() => { if (active) setGoogleEnabled(false); });
    return () => { active = false; };
  }, []);

  async function signInWithGoogle() {
    setBusy(true); setError(""); setMessage("");
    const currentPath = `${location.pathname}${location.search}`;
    const destination = callbackURL ?? (['/sign-in', '/reset-password'].includes(location.pathname) ? '/studio' : currentPath);
    try {
      const result = await api.socialSignIn('google', destination || '/studio');
      const authorization = new URL(result.url);
      if (authorization.protocol !== 'https:' || authorization.hostname !== 'accounts.google.com' || authorization.pathname !== '/o/oauth2/v2/auth') {
        throw new Error('Google sign-in returned an invalid authorization URL. Please try again.');
      }
      location.assign(authorization.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in isn't available right now.");
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      if (magic) {
        const destination = ['/sign-in', '/reset-password'].includes(location.pathname) ? '/studio' : `${location.pathname}${location.search}`;
        await api.magicLink(email.trim(), callbackURL ?? destination);
        setMessage("Check your inbox for a sign-in link. It works once and expires in 10 minutes.");
      } else if (mode === "forgot") {
        setMessage((await api.forgotPassword(email.trim())).message);
      } else if (mode === "reset") {
        const token = new URLSearchParams(location.hash.slice(1)).get("token");
        if (!token) throw new Error("This reset link is missing its token. Request a new link.");
        await api.resetPassword(token, password);
        history.replaceState(null, "", "/sign-in");
        onMode("login"); setPasswordLogin(true);
        setMessage("Your password has been updated. Sign in with your new password.");
      } else {
        const result = await api.auth(mode, email.trim(), password);
        onDone(result.user); onClose();
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not sign in. Please try again."); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="modal signin" aria-label="Sign in" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="signin-grid">
      <div className="signin-form">
        <button type="button" className="signin-x" aria-label="Close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <span className="signin-mark" aria-hidden="true"><img src="/favicon.svg" width="48" height="48" alt="" /></span>
        <p className="signin-title">{mode === "reset" ? "Choose a new password" : mode === "forgot" ? "Reset your password" : "Welcome to Claude Motion Video"}</p>
        <p className="muted">{mode === "forgot" ? "Enter your email and we'll send you a password reset link." : mode === "reset" ? "Choose a new password for your account." : "Make videos with Claude Opus 5.5. Sign in to keep your credits and pick up where you left off."}</p>
        {googleEnabled && (mode === 'login' || mode === 'register') && <>
          <button type="button" className="btn signin-google" onClick={() => void signInWithGoogle()} disabled={busy}>
            <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            {busy ? 'Connecting…' : 'Continue with Google'}
          </button>
          {(mode === 'login' || mode === 'register') && <div className="or"><span>or</span></div>}
        </>}
        {message && magic ? <p className="ok-note" role="status">{message}</p> : <form className="signin-email" onSubmit={submit}>
          {mode !== "reset" && <><label htmlFor="signin-email">Email address</label><input id="signin-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="Enter your email" autoComplete="email" /></>}
          {!magic && mode !== "forgot" && <><label htmlFor="signin-password">{mode === "reset" ? "New password" : "Password"}</label><input id="signin-password" type="password" required minLength={10} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 10 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} /></>}
          <button type="submit" className="btn primary" disabled={busy || (mode !== "reset" && !email.trim())}>{busy ? "Sending…" : magic ? "Continue" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Update password" : mode === "register" ? "Create account" : "Sign in"}</button>
        </form>}
        {error && <p className="error" role="alert">{error}</p>}
        {message && !magic && <p className="ok-note" role="status">{message}</p>}
        <div className="cmv-auth-options">
          {magic ? <button type="button" onClick={() => setPasswordLogin(true)}>Use a password instead</button> : <>
            {mode === "login" && <button type="button" onClick={() => onMode("forgot")}>Forgot password?</button>}
            <button type="button" onClick={() => { onMode("login"); setPasswordLogin(false); }}>Sign in with an email link</button>
            {(mode === "login" || mode === "register") && <button type="button" onClick={() => onMode(mode === "register" ? "login" : "register")}>{mode === "register" ? "Already have an account? Sign in" : "Create an account with a password"}</button>}
          </>}
        </div>
        <p className="signin-legal">By continuing, you agree to our <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</p>
      </div>
      <div className="signin-media" aria-hidden="true"><video src="/reference-assets/media/signin.mp4" poster="/reference-assets/media/signin-poster.jpg" autoPlay muted loop playsInline /><span className="signin-tag">Made with Opus 5.5</span></div>
    </div>
  </dialog>;
}
