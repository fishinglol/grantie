import { useState } from "react";
import type { GoogleSession } from "@granite/core-cloud";

import { isGoogleConfigured } from "./config";
import { signInWithGoogle } from "./googleLogin";

export interface LoginPageProps {
  onSignedIn: (session: GoogleSession) => void;
  /** Enter the app with no cloud account at all. */
  onSkip: () => void;
}

export default function LoginPage({ onSignedIn, onSkip }: LoginPageProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isGoogleConfigured();

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signInWithGoogle());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="mark" aria-hidden="true" />
        <h1>Granite</h1>
        <p className="tagline">Your notes stay on this Mac. Drive is just the mirror.</p>

        <ul className="promises">
          <li>Plain <code>.md</code> files in <code>Documents/GraniteVault</code> — always readable without Granite.</li>
          <li>Notes and images sync both ways with a <b>Granite Vault</b> folder in your Drive.</li>
          <li>Granite can only see files it created. The rest of your Drive stays private to it.</li>
        </ul>

        {configured ? (
          <button className="google" onClick={connect} disabled={busy}>
            <GoogleMark />
            {busy ? "Waiting for your browser…" : "Continue with Google"}
          </button>
        ) : (
          <div className="setup">
            <b>One-time setup needed.</b> Create an OAuth <i>Desktop app</i> client in the
            Google Cloud console, then put its ID in <code>apps/desktop/.env</code>:
            <pre>VITE_GOOGLE_CLIENT_ID=…apps.googleusercontent.com{"\n"}VITE_GOOGLE_CLIENT_SECRET=…</pre>
            Steps are in <code>apps/desktop/README.md</code>.
          </div>
        )}

        {busy && (
          <p className="hint">
            A Google sign-in page opened in your browser. Finish there and this window continues on its own.
          </p>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <button className="skip" onClick={onSkip} disabled={busy}>
          Continue without syncing
        </button>
        <p className="fineprint">
          You can connect Drive later — nothing about your notes changes either way.
        </p>
      </div>
    </div>
  );
}

/** Google's four-colour G, inline so the login page makes no network requests. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.8l7.8 6c1.9-5.7 7.2-9.8 13.6-9.8z" />
      <path fill="#4285F4" d="M46.6 24.6c0-1.6-.1-3.2-.4-4.6H24v9.1h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.2-10.1 7.2-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.2c-.5-1.4-.8-2.9-.8-4.2s.3-2.8.8-4.2l-7.8-6C.9 17 0 20.4 0 24s.9 7 2.6 10.2l7.8-6z" />
      <path fill="#34A853" d="M24 47.5c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.1 14.6 47.5 24 47.5z" />
    </svg>
  );
}
