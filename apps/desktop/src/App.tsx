import { useCallback, useEffect, useState } from "react";
import type { GoogleSession } from "@granite/core-cloud";

import LoginPage from "./LoginPage";
import VaultSetupPage from "./VaultSetupPage";
import NoteApp from "./NoteApp";
import { restoreGoogleSession } from "./googleLogin";
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

export default function App() {
  const [gate, setGate] = useState<Gate>({ kind: "checking" });

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
        onSignedIn={(session) => setGate({ kind: "setup", session })}
        onSkip={() => setGate({ kind: "setup", session: null })}
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
    <NoteApp
      session={gate.session}
      vaultDir={gate.vaultDir}
      onSignOut={() => signOut(gate.session)}
      onOpenVaultSetup={() =>
        setGate({ kind: "setup", session: gate.session, previousVaultDir: gate.vaultDir })
      }
    />
  );
}
