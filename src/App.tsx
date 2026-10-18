import { useCallback, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AuthModal } from "./AuthModal";
import {
  ArticlePage,
  BlogsPage,
  EffectsPage,
  ExamplesPage,
  HomePage,
  LegalPage,
  NotFound,
  PricingPage,
  SiteLayout,
} from "./Marketing";
import { api, type User } from "./lib/api";
import type { AuthMode } from "./lib/ui-types";
import { StudioPage } from "./Studio";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const location = useLocation();

  const refreshMe = useCallback(
    () =>
      api
        .me()
        .then((result) => {
          setUser(result.user);
          setBillingEnabled(result.billingEnabled);
        })
        .catch(() => {
          setUser(null);
          setBillingEnabled(false);
        })
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "n" &&
        location.pathname === "/studio"
      ) {
        event.preventDefault();
        window.dispatchEvent(new Event("cmv:new-project"));
      }
      if (event.key === "Escape") setAuthMode(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/reset-password") setAuthMode("reset");
  }, [location.pathname, location.hash]);

  async function logout() {
    try {
      await api.logout();
      setUser(null);
      setNotice("You are signed out.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not sign out.");
    }
    setTimeout(() => setNotice(""), 2500);
  }

  const auth = (mode: AuthMode) => setAuthMode(mode);
  const layout = (children: React.ReactNode) => (
    <SiteLayout user={user} onAuth={auth} onLogout={() => void logout()}>
      {children}
    </SiteLayout>
  );

  return (
    <div className="app-root">
      {loading && (
        <div className="boot-screen">
          <span className="brand-mark">
            <span />
          </span>
          <span>CLAUDE MOTION VIDEO</span>
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={layout(<HomePage user={user} onAuth={auth} />)}
        />
        <Route
          path="/pricing"
          element={layout(
            <PricingPage
              user={user}
              onAuth={auth}
              billingEnabled={billingEnabled}
            />,
          )}
        />
        <Route path="/examples" element={layout(<ExamplesPage />)} />
        <Route path="/effects" element={layout(<EffectsPage />)} />
        <Route path="/blogs" element={layout(<BlogsPage />)} />
        <Route path="/blogs/:slug" element={layout(<ArticlePage />)} />
        <Route
          path="/studio"
          element={
            <StudioPage
              user={user}
              onAuth={auth}
              onCredits={() => void refreshMe()}
              onLogout={() => void logout()}
            />
          }
        />
        <Route path="/terms" element={layout(<LegalPage kind="terms" />)} />
        <Route path="/privacy" element={layout(<LegalPage kind="privacy" />)} />
        <Route path="/refund" element={layout(<LegalPage kind="refund" />)} />
        <Route path="/contact" element={layout(<LegalPage kind="contact" />)} />
        <Route
          path="/reset-password"
          element={layout(<HomePage user={user} onAuth={auth} />)}
        />
        <Route path="*" element={layout(<NotFound />)} />
      </Routes>
      {authMode && (
        <AuthModal
          mode={authMode}
          onMode={setAuthMode}
          onClose={() => setAuthMode(null)}
          onDone={(nextUser) => {
            setUser(nextUser);
            void refreshMe();
          }}
        />
      )}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}
