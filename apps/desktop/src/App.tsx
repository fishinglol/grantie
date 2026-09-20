import { useCallback, useEffect, useRef, useState } from "react";
import type { GoogleSession } from "@granite/core-cloud";

import ConnectDialog from "./ConnectDialog";
import LoginPage from "./LoginPage";
import VaultSetupPage from "./VaultSetupPage";
import NoteApp from "./NoteApp";
import { isGoogleConfigured } from "./config";
import { restoreGoogleSession, signInWithGoogle } from "./googleLogin";
import { getStoredVaultDir } from "./vault";
import "./App.css";

/**
 * `checking` — looking for a session & stored vault saved by a previous launch.
 * `login`    — the first page: connect Drive, or explicitly go without.
 * `setup`    — onboarding / vault picker & multi-source importer screen.
 * `ready`    — the note app, with a session (syncing) or without (local only).
 */
type Gate =
  | { kind: "checking" }
  | { kind: "login" }
  | { kind: "setup"; session: GoogleSession | null; previousVaultDir?: string }
  | { kind: "ready"; session: GoogleSession | null; vaultDir: string };

type Connect = null | { phase: "waiting" | "unconfigured" } | { phase: "error"; message: string };

export default function App() {
  const [gate, setGate] = useState<Gate>({ kind: "checking" });
  const [connect, setConnect] = useState<Connect>(null);
  /** Bumped on cancel so a sign-in that finishes later is ignored. */
  const connectAttempt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    restoreGoogleSession()
      .then(async (session) => {
        if (cancelled) return;
        if (!session) return setGate({ kind: "login" });
        // Being offline right now must not send a signed-in user back to a
        // login screen — the whole point is that the app works without a network.
        await session.ensureUser().catch(() => undefined);
        const storedVault = await getStoredVaultDir();
        if (!cancelled) {
          if (storedVault) {
            setGate({ kind: "ready", session, vaultDir: storedVault });
          } else {
            setGate({ kind: "setup", session });
          }
        }
      })
      .catch(() => !cancelled && setGate({ kind: "login" }));
    return () => {
      cancelled = true;
    };
  }, []);

  /** "Connect Drive" from inside the app: sign in, then stay in the same note and vault. */
  const connectDrive = useCallback(async (vaultDir: string) => {
    if (!isGoogleConfigured()) return setConnect({ phase: "unconfigured" });
    const attempt = ++connectAttempt.current;
    setConnect({ phase: "waiting" });
    try {
      const session = await signInWithGoogle();
      if (connectAttempt.current !== attempt) return;
      setGate({ kind: "ready", session, vaultDir });
      setConnect(null);
    } catch (e) {
      if (connectAttempt.current !== attempt) return;
      setConnect({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const cancelConnect = useCallback(() => {
    connectAttempt.current++;
    setConnect(null);
  }, []);

  /** After login/skip: an existing vault goes straight to the notes; only a first run needs setup. */
  const enter = useCallback(async (session: GoogleSession | null) => {
    const vaultDir = await getStoredVaultDir();
    setGate(vaultDir ? { kind: "ready", session, vaultDir } : { kind: "setup", session });
  }, []);

  const signOut = useCallback(async (session: GoogleSession | null) => {
    await session?.signOut().catch(() => undefined);
    setGate({ kind: "login" });
  }, []);

  if (gate.kind === "checking") {
    return (
      <div className="login">
        <div className="login-card">
          <div className="mark" aria-hidden="true" />
          <p className="tagline">Opening your vault…</p>
        </div>
      </div>
    );
  }

  if (gate.kind === "login") {
    return (
      <LoginPage
        onSignedIn={(session) => void enter(session)}
        onSkip={() => void enter(null)}
      />
    );
  }

  if (gate.kind === "setup") {
    return (
      <VaultSetupPage
        onVaultReady={(vaultDir) => setGate({ kind: "ready", session: gate.session, vaultDir })}
        onCancel={
          gate.previousVaultDir
            ? () => setGate({ kind: "ready", session: gate.session, vaultDir: gate.previousVaultDir! })
            : undefined
        }
      />
    );
  }

  return (
    <>
      <NoteApp
        session={gate.session}
        vaultDir={gate.vaultDir}
        onSignOut={() => signOut(gate.session)}
        onConnectDrive={() => void connectDrive(gate.vaultDir)}
        onOpenVaultSetup={() =>
          setGate({ kind: "setup", session: gate.session, previousVaultDir: gate.vaultDir })
        }
      />
      {connect && (
        <ConnectDialog
          phase={connect.phase}
          message={connect.phase === "error" ? connect.message : undefined}
          onCancel={cancelConnect}
          onRetry={() => void connectDrive(gate.vaultDir)}
        />
      )}
    </>
  );
}
