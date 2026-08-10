type CloudId = "drive" | "dropbox" | "onedrive" | "icloud"

const LABELS: Record<CloudId, string> = {
  drive: "Google Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  icloud: "iCloud",
}

export default function CloudIcon({ id, className }: { id: CloudId; className?: string }) {
  const label = LABELS[id]

  if (id === "drive") {
    return (
      <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={label}>
        <path d="M8.4 1.5 1.6 13l3 5.3h6.1l-3-5.3 3.6-6.3-2.9-5.2Z" fill="#FFC107" />
        <path d="M12.1 1.5 8.4 8l3.6 6.3h7.4L16 8l-3.9-6.5Z" fill="#4CAF50" />
        <path d="M4.6 18.3h14.8L22.4 13H1.6l3 5.3Z" fill="#2196F3" />
      </svg>
    )
  }
  if (id === "dropbox") {
    return (
      <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={label}>
        <path d="M6.5 2 1 5.6l5.5 3.5L12 5.6 6.5 2Zm11 0L12 5.6l5.5 3.5L23 5.6 17.5 2ZM1 12.6l5.5 3.5L12 12.6 6.5 9.1 1 12.6Zm16.5-3.5L12 12.6l5.5 3.5 5.5-3.5-5.5-3.5ZM6.6 17.3l5.4 3.5 5.4-3.5-5.4-3.4-5.4 3.4Z" fill="#0061FF" />
      </svg>
    )
  }
  if (id === "onedrive") {
    return (
      <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={label}>
        <path d="M9.9 7.4a5.4 5.4 0 0 1 8.3 1.4 4.1 4.1 0 0 1 3.6 4 4 4 0 0 1-4 4.1H8.1A4.6 4.6 0 0 1 8 8.4a5.4 5.4 0 0 1 1.9-1Z" fill="#0364B8" />
        <path d="M8.1 16.9h9.7a4 4 0 0 0 3.9-3.2 4.1 4.1 0 0 0-3.5-4.5 5.4 5.4 0 0 0-9.6-.8 4.6 4.6 0 0 0-.5 8.5Z" fill="#0078D4" opacity="0.75" />
      </svg>
    )
  }
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={label}>
      <path d="M17.4 18.4H8a4.6 4.6 0 0 1-.9-9.1 5.5 5.5 0 0 1 10.1-1.2 3.9 3.9 0 0 1 .2 10.3Z" fill="none" stroke="#3B9EFF" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

export const CLOUD_IDS: CloudId[] = ["drive", "dropbox", "onedrive", "icloud"]
