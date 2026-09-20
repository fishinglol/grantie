export interface DeleteDialogProps {
  /** File name shown in the question. */
  name: string;
  /** True when Drive sync is on, so the note's Drive copy goes to the Drive trash as well. */
  synced: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** "Delete this note?" — confirmation before a note is removed from the vault. */
export default function DeleteDialog({ name, synced, onCancel, onConfirm }: DeleteDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <h2>Delete “{name}”?</h2>
        <p>
          The file is deleted from this computer and can't be restored from here.
          {synced && " Its copy in Google Drive goes to the Drive trash, and it is removed from your other devices."}
        </p>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" autoFocus onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
