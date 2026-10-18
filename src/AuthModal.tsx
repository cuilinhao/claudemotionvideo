import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, LoaderCircle, X } from "lucide-react";
import { api, type User } from "./lib/api";
import type { AuthMode } from "./lib/ui-types";

export function AuthModal({
  mode,
  onMode,
  onClose,
  onDone,
}: {
  mode: AuthMode;
  onMode: (m: AuthMode) => void;
  onClose: () => void;
  onDone: (u: User) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setError("");
    setPassword("");
    if (mode !== "login") setMessage("");
  }, [mode]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "forgot") {
        const result = await api.forgotPassword(email.trim());
        setMessage(result.message);
      } else if (mode === "reset") {
        const token = new URLSearchParams(window.location.hash.slice(1)).get(
          "token",
        );
        if (!token)
          throw new Error(
            "This reset link is missing its token. Request a new link.",
          );
        await api.resetPassword(token, password);
        setMessage(
          "Your password has been updated. Sign in with your new password.",
        );
        onMode("login");
      } else {
        const r = await api.auth(mode, email.trim(), password);
        onDone(r.user);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="auth-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <div className="auth-emblem">
          <span />
        </div>
        <p className="eyebrow">YOUR STUDIO, READY WHEN YOU ARE</p>
        <h2>
          {mode === "login"
            ? "Welcome back."
            : mode === "register"
              ? "Create your account."
              : mode === "forgot"
                ? "Reset your password."
                : "Choose a new password."}
        </h2>
        <p className="muted">
          {mode === "login"
            ? "Sign in to find your projects and credits."
            : mode === "register"
              ? "Sign up to save your work. Pick a plan to start generating."
              : mode === "forgot"
                ? "Enter your account email and we’ll send a reset link if an account exists."
                : "Choose a new password for your account."}
        </p>
        <form onSubmit={submit}>
          {mode !== "reset" && (
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
              />
            </label>
          )}
          {(mode === "login" || mode === "register" || mode === "reset") && (
            <label>
              {mode === "reset" ? "New password" : "Password"}
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={10}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 10 characters"
              />
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          {message && (
            <p className="form-success" role="status">
              {message}
            </p>
          )}
          <button className="button button-primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : null}
            {mode === "login"
              ? "Sign in"
              : mode === "register"
                ? "Create account"
                : mode === "forgot"
                  ? "Send reset link"
                  : "Update password"}
            <ArrowRight size={16} />
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login"
            ? "Don't have an account?"
            : mode === "register"
              ? "Already have an account?"
              : "Back to"}{" "}
          <button
            onClick={() => onMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Create one" : "Sign in"}
          </button>
        </p>
        {mode === "login" && (
          <p className="auth-switch">
            <button onClick={() => onMode("forgot")}>Forgot password?</button>
          </p>
        )}
        <p className="fine-print">
          By continuing, you agree to our{" "}
          <Link to="/terms" onClick={onClose}>
            Terms
          </Link>{" "}
          and{" "}
          <Link to="/privacy" onClick={onClose}>
            Privacy Policy
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
