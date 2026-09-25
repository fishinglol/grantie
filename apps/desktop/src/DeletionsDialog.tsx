import type { PendingDeletion } from "@granite/core-cloud";

export interface DeletionsDialogProps {
  files: PendingDeletion[];
  onAnswer: (ok: boolean) => void;
}

const SHOWN = 12;

function Group({ files, title }: { files: PendingDeletion[]; title: string }) {
  if (files.length === 0) return null;
  return (
    <>
      <p className="modal-list-title">{title}</p>
      <ul className="modal-list">
        {files.slice(0, SHOWN).map((f) => (
          <li key={f.path}>{f.path}</li>
        ))}
        {files.length > SHOWN && <li className="more">…and {files.length - SHOWN} more</li>}
      </ul>
    </>
  );
}

/** Drive sync stopped because it would delete a lot at once: shows the files and asks before going ahead. */
export default function DeletionsDialog({ files, onAnswer }: DeletionsDialogProps) {
  const here = files.filter((f) => f.where === "here");
  const drive = files.filter((f) => f.where === "drive");
  return (
    <div className="modal-backdrop" onClick={() => onAnswer(false)}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onAnswer(false)}
      >
        <h2>Delete {files.length} files to match?</h2>
        <p>Sync paused because this would delete a lot at once. Nothing has been changed yet. Choose “Not now” if you are not sure.</p>
        <Group files={here} title={`Deleted in Google Drive, so deleted from this computer (${here.length}, can't be restored from here):`} />
        <Group files={drive} title={`Deleted from this computer, so moved to the Drive trash (${drive.length}):`} />
        <div className="modal-actions">
          <button autoFocus onClick={() => onAnswer(false)}>
            Not now
          </button>
          <button className="danger" onClick={() => onAnswer(true)}>
            Delete {files.length} files
          </button>
        </div>
      </div>
    </div>
  );
}
