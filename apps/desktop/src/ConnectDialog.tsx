export interface ConnectDialogProps {
  phase: "waiting" | "error" | "unconfigured";
  message?: string;
  onCancel: () => void;
  onRetry: () => void;
}

/** Small dialog over the notes while "Connect Drive" runs; the sign-in itself happens in the browser. */
export default function ConnectDialog({ phase, message, onCancel, onRetry }: ConnectDialogProps) {
  return (
    <div className="modal-backdrop" onClick={phase === "waiting" ? undefined : onCancel}>
      <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {phase === "waiting" && (
          <>
            <div className="modal-spinner" aria-hidden="true" />
            <h2>Waiting for Google…</h2>
            <p>
              A sign-in page opened in your browser. Finish there and you'll come straight back to your notes.
            </p>
            <div className="modal-actions">
              <button onClick={onCancel}>Cancel</button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <h2>Couldn't connect</h2>
            <p className="modal-error" role="alert">{message}</p>
            <div className="modal-actions">
              <button onClick={onCancel}>Cancel</button>
              <button className="primary" onClick={onRetry}>Try again</button>
            </div>
          </>
        )}

        {phase === "unconfigured" && (
          <>
            <h2>One-time setup needed</h2>
            <p>
              Create an OAuth <i>Desktop app</i> client in the Google Cloud console, then put its ID in{" "}
              <code>apps/desktop/.env</code>:
            </p>
            <pre>VITE_GOOGLE_CLIENT_ID=…apps.googleusercontent.com{"\n"}VITE_GOOGLE_CLIENT_SECRET=…</pre>
            <p>Steps are in <code>apps/desktop/README.md</code>.</p>
            <div className="modal-actions">
              <button className="primary" onClick={onCancel}>Got it</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
