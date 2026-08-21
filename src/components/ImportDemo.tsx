import { useEffect, useRef, useState } from "react"
import CloudIcon, { CLOUD_IDS } from "./CloudIcon"

const FILES = [
  { ext: "md", name: "my-vault.md" },
  { ext: "jex", name: "notebook.jex" },
  { ext: "zip", name: "workspace.zip" },
]
const COUNTS = [128, 297, 412]

// One panel is on stage at a time — the layers cross-fade with a delay on the
// incoming one, so two of them are never legible at once.
type Phase = "drop" | "reading" | "result" | "sync"

export default function ImportDemo() {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  const [phase, setPhase] = useState<Phase>(prefersReducedMotion ? "sync" : "drop")
  const [status, setStatusText] = useState(
    prefersReducedMotion ? "Synced to your cloud" : "Drag in your vault folder"
  )
  const [statusOpacity, setStatusOpacity] = useState(1)
  // The pointer walks through these in order: off-stage, reaching for the
  // folder, holding it during the drag, then letting go.
  const [cursor, setCursor] = useState<"off" | "reach" | "hold" | "released">("off")
  const [grabbed, setGrabbed] = useState(false)
  const [dragDropped, setDragDropped] = useState(false)
  const [dropFilled, setDropFilled] = useState(false)
  const [sending, setSending] = useState(
    prefersReducedMotion ? [true, true, true] : [false, false, false]
  )
  const [vaultCount, setVaultCount] = useState(prefersReducedMotion ? "412 notes" : "0 notes")
  const [vaultPulse, setVaultPulse] = useState(false)
  const [cloudsOn, setCloudsOn] = useState(
    prefersReducedMotion ? [true, true, true, true] : [false, false, false, false]
  )

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    if (prefersReducedMotion) return

    const at = (ms: number, fn: () => void) => {
      timers.current.push(setTimeout(fn, ms))
    }

    const setStatus = (text: string) => {
      setStatusOpacity(0)
      at(200, () => {
        setStatusText(text)
        setStatusOpacity(1)
      })
    }

    function run() {
      timers.current.forEach(clearTimeout)
      timers.current = []

      // Reset happens while the drop layer is still hidden, so nothing snaps on screen.
      setPhase("drop")
      setCursor("off")
      setGrabbed(false)
      setDragDropped(false)
      setDropFilled(false)
      setSending([false, false, false])
      setCloudsOn([false, false, false, false])
      setVaultCount("0 notes")
      setStatus("Drag in your vault folder")

      // 1. A pointer comes in, picks the vault folder up and drags it into the zone.
      at(560, () => setCursor("reach"))
      at(1060, () => {
        setCursor("hold")
        setGrabbed(true)
      })
      at(1300, () => setDragDropped(true))
      at(2180, () => {
        setCursor("released")
        setGrabbed(false)
        setDropFilled(true)
      })
      at(2320, () => setStatus("Vault folder dropped"))

      // 2. Granite reads it — the files inside stream out toward the vault.
      at(2980, () => setStatus("Reading your files"))
      at(3080, () => setPhase("reading"))

      FILES.forEach((_, i) => {
        const t = 3680 + i * 600
        at(t, () => setSending((prev) => prev.map((v, idx) => (idx === i ? true : v))))
        at(t + 380, () => {
          setVaultCount(COUNTS[i] + " notes")
          setVaultPulse(true)
          setTimeout(() => setVaultPulse(false), 300)
        })
      })

      // 3. What survived the import.
      at(5730, () => {
        setPhase("result")
        setStatus("Nothing left behind")
      })

      // 4. And out to whichever cloud you already pay for.
      at(6930, () => setStatus("Syncing to your cloud"))
      CLOUD_IDS.forEach((_, i) =>
        at(7030 + i * 200, () =>
          setCloudsOn((prev) => prev.map((v, idx) => (idx === i ? true : v)))
        )
      )
      at(7930, () => {
        setPhase("sync")
        setStatus("Synced to your cloud")
      })

      at(10600, run)
    }
    run()

    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const layer = (name: Phase | Phase[]) => {
    const active = Array.isArray(name) ? name.includes(phase) : phase === name
    return "demo-layer" + (active ? " active" : "")
  }

  return (
    <div className="import-demo" aria-label="Importing an existing vault into Granite">
      <div className="demo-status" style={{ opacity: statusOpacity }}>
        {status}
      </div>

      <div className="demo-stage">
        <div className="demo-panel">
          <div className={layer("drop") + " is-drop"} aria-hidden="true">
            {/* Where the folder sits before the drag; the rig floats above it. */}
            <div className="drop-rest" />
            <div className={"drop-zone" + (dropFilled ? " filled" : "")}>
              <div className="drop-slot" />
              <span className="drop-hint">{dropFilled ? "my-vault/" : "Drop your vault"}</span>
            </div>

            <div className={"drag-rig" + (dragDropped ? " dropped" : "")}>
              <svg className={"drag-item" + (grabbed ? " grabbed" : "")} viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 7a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
                  fill="currentColor"
                />
              </svg>
              <svg
                className={"drag-cursor" + (cursor === "off" ? "" : " " + cursor)}
                viewBox="0 0 24 24"
              >
                <path
                  d="M4 2l0 16.5 4.2-4.1 2.6 6 3.3-1.4-2.6-5.9 5.9 0z"
                  fill="var(--dark)"
                  stroke="var(--white)"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          <div className={layer("reading")} aria-hidden="true">
            {FILES.map((file, i) => (
              <div key={file.name} className={"src-file" + (sending[i] ? " sending" : "")}>
                <span className="fbadge">{file.ext}</span>
                {file.name}
              </div>
            ))}
          </div>

          <div className={layer(["result", "sync"])} aria-hidden="true">
            <div className="done-line">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <b>1,204</b> links still linked
            </div>
            <div className="done-line">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <b>38</b> attachments kept
            </div>
            <div className="done-line">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              folder tree preserved
            </div>
          </div>
        </div>

        <div className={"vault" + (vaultPulse ? " pulse" : "")}>
          <img className="vault-slabs" src="/logo-128.png" alt="" aria-hidden="true" />
          <div className="vault-count">{vaultCount}</div>
        </div>
      </div>

      <div className="cloud-bar">
        <span className="cb-label">Synced to</span>
        <div className="cb-icons">
          {CLOUD_IDS.map((id, i) => (
            <CloudIcon key={id} id={id} className={cloudsOn[i] ? "on" : undefined} />
          ))}
        </div>
      </div>
    </div>
  )
}
