export interface DeleteDialogProps {
  /** File or folder name shown in the question. */
  name: string;
  /** Set when deleting a folder: how many notes are inside it. */
  folderNotes?: number;
  /** Set when several rows picked in the sidebar are deleted at once: how many. */
  count?: number;
  /** True when Drive sync is on, so the note's Drive copy goes to the Drive trash as well. */
  synced: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** "Delete this note?" — confirmation before a note or a whole folder is removed from the vault. */
export default function DeleteDialog({ name, folderNotes, count, synced, onCancel, onConfirm }: DeleteDialogProps) {
  const isFolder = folderNotes !== undefined;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <h2>{count ? `Delete ${count} items?` : <>Delete {isFolder && "folder "}“{name}”?</>}</h2>
        <p>
          {count
            ? "The picked files, and the folders with everything in them, are deleted from this computer and can't be restored from here."
            : isFolder
            ? `The folder and everything in it (${folderNotes} ${folderNotes === 1 ? "note" : "notes"}, plus its images and other files) is deleted from this computer and can't be restored from here.`
            : "The file is deleted from this computer and can't be restored from here."}
          {synced &&
            (count
              ? " Their copies in Google Drive go to the Drive trash, and they are removed from your other devices."
              : ` ${isFolder ? "Their copies" : "Its copy"} in Google Drive go${isFolder ? "" : "es"} to the Drive trash, and ${isFolder ? "they are" : "it is"} removed from your other devices.`)}
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
