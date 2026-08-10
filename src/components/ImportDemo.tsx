import { useEffect, useRef, useState } from "react"
import CloudIcon, { CLOUD_IDS } from "./CloudIcon"

const FILES = [
  { ext: "md", name: "my-vault.md" },
  { ext: "jex", name: "notebook.jex" },
  { ext: "zip", name: "workspace.zip" },
]
const COUNTS = [128, 297, 412]

const REDUCED_MOTION_STATE = {
  status: "Synced to your cloud",
  sending: [true, true, true],
  vaultCount: "412 notes",
  vaultPulse: false,
  doneShown: true,
  cloudsOn: [true, true, true, true],
}

const INITIAL_STATE = {
  status: "Drop in your old vault",
  sending: [false, false, false],
  vaultCount: "0 notes",
  vaultPulse: false,
  doneShown: false,
  cloudsOn: [false, false, false, false],
}

export default function ImportDemo() {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  const [status, setStatusText] = useState(
    prefersReducedMotion ? REDUCED_MOTION_STATE.status : INITIAL_STATE.status
  )
  const [statusOpacity, setStatusOpacity] = useState(1)
  const [sending, setSending] = useState(
    prefersReducedMotion ? REDUCED_MOTION_STATE.sending : INITIAL_STATE.sending
  )
  const [vaultCount, setVaultCount] = useState(
    prefersReducedMotion ? REDUCED_MOTION_STATE.vaultCount : INITIAL_STATE.vaultCount
  )
  const [vaultPulse, setVaultPulse] = useState(false)
  const [doneShown, setDoneShown] = useState(
    prefersReducedMotion ? REDUCED_MOTION_STATE.doneShown : INITIAL_STATE.doneShown
  )
  const [cloudsOn, setCloudsOn] = useState(
    prefersReducedMotion ? REDUCED_MOTION_STATE.cloudsOn : INITIAL_STATE.cloudsOn
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

    const reset = () => {
      setSending([false, false, false])
      setCloudsOn([false, false, false, false])
      setDoneShown(false)
      setVaultCount("0 notes")
      setStatus("Drop in your old vault")
    }

    function run() {
      timers.current.forEach(clearTimeout)
      timers.current = []
      reset()

      at(900, () => setStatus("Reading your files"))

      FILES.forEach((_, i) => {
        const t = 1200 + i * 700
        at(t, () => setSending((prev) => prev.map((v, idx) => (idx === i ? true : v))))
        at(t + 380, () => {
          setVaultCount(COUNTS[i] + " notes")
          setVaultPulse(true)
          setTimeout(() => setVaultPulse(false), 300)
        })
      })

      at(3300, () => {
        setDoneShown(true)
        setStatus("Nothing left behind")
      })

      CLOUD_IDS.forEach((_, i) =>
        at(4600 + i * 200, () => setCloudsOn((prev) => prev.map((v, idx) => (idx === i ? true : v))))
      )
      at(4800, () => setStatus("Synced to your cloud"))

      at(8200, run)
    }
    run()

    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="import-demo" aria-label="Importing an existing vault into Granite">
      <div className="demo-status" style={{ opacity: statusOpacity }}>
        {status}
      </div>

      <div className="demo-stage">
        <div className="src-slot">
          <div className="src-col">
            {FILES.map((file, i) => (
              <div key={file.name} className={"src-file" + (sending[i] ? " sending" : "")}>
                <span className="fbadge">{file.ext}</span>
                {file.name}
              </div>
            ))}
          </div>
          <div className={"src-done" + (doneShown ? " show" : "")} aria-hidden="true">
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
          <svg className="vault-slabs" viewBox="0 0 150 190" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <ellipse cx="70" cy="176" rx="48" ry="7" fill="#1C1B1A" opacity="0.1" />
            <g transform="translate(64 14) rotate(12)">
              <rect width="64" height="102" rx="6" fill="var(--quartz)" />
            </g>
            <g transform="translate(40 20) rotate(3)">
              <rect width="66" height="106" rx="6" fill="var(--sand)" />
            </g>
            <g transform="translate(14 26) rotate(-9)">
              <rect width="68" height="110" rx="6" fill="var(--dark)" />
              <g stroke="var(--paper-40)" strokeWidth="2.4" strokeLinecap="round">
                <path d="M15 30H46" />
                <path d="M15 44H55" />
                <path d="M15 58H39" />
              </g>
              <path d="M15 78H55" stroke="var(--lichen-lift)" strokeWidth="2.4" strokeLinecap="round" opacity="0.75" />
            </g>
          </svg>
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
