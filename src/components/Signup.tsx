import { useEffect, useState, type FormEvent } from "react"
import { createClient } from "@supabase/supabase-js"
import { Cloud, FileText, FolderTree, Link2, RefreshCw } from "lucide-react"
import MarqueeAlongSvgPath from "./ui/marquee-along-svg-path"
import { getAttributionData } from "../lib/attribution"

const WAVE_PATH =
  "M0 260 C 200 160, 400 360, 600 220 C 800 80, 1000 320, 1200 180"

const ICONS = [
  { Icon: Cloud, color: "#4C8FD9" },
  { Icon: FolderTree, color: "#5C6E52" },
  { Icon: FileText, color: "#8B7355" },
  { Icon: Link2, color: "#B2593D" },
  { Icon: RefreshCw, color: "#9DAE8F" },
]

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
const sb = supabaseConfigured ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : null

const PLATFORMS = [
  { id: "obsidian", label: "Obsidian" },
  { id: "joplin", label: "Joplin" },
  { id: "notion", label: "Notion" },
  { id: "other", label: "Something else" },
]

export default function Signup() {
  const [email, setEmail] = useState("")
  const [platform, setPlatform] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    // Initialize attribution immediately on mount
    getAttributionData()

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduceMotion(mq.matches)
    const onChange = () => setReduceMotion(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    if (!sb) {
      setError("Signup isn't connected yet — missing Supabase config.")
      setSubmitting(false)
      console.error("Supabase is not configured — fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.")
      return
    }

    const attribution = getAttributionData()

    const payload = {
      email,
      platform,
      source: attribution.source,
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_content: attribution.utm_content,
      referrer_url: attribution.referrer_url,
    }

    let { error: insertError } = await sb.from("waitlist").insert(payload)

    // Fallback: If DB table does not have attribution columns yet, retry with basic fields
    if (insertError && insertError.code !== "23505") {
      console.warn("Retrying signup with basic payload in case of schema discrepancy:", insertError)
      const fallbackResult = await sb.from("waitlist").insert({ email, platform })
      insertError = fallbackResult.error
    }

    if (insertError) {
      setSubmitting(false)
      if (insertError.code === "23505") {
        // Unique constraint on email — they're already signed up, treat as success.
        setSuccess("You're already on the list.")
      } else {
        console.error("Signup error", insertError)
        setError("Something went wrong — try again in a moment.")
      }
      return
    }

    // Fire-and-forget: the signup itself is already saved, so the email isn't load-bearing.
    fetch("/api/send-welcome-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch((err) => console.error("Welcome email failed to send", err))

    setSuccess("You're on the list — we'll email you first.")
  }

  return (
    <section className="section signup" id="signup">
      {!reduceMotion && (
        <MarqueeAlongSvgPath
          path={WAVE_PATH}
          viewBox="0 0 1200 400"
          baseVelocity={6}
          repeat={2}
          responsive
          className="signup-marquee"
        >
          {ICONS.map(({ Icon, color }, i) => (
            <Icon key={i} size={26} strokeWidth={1.6} color={color} />
          ))}
        </MarqueeAlongSvgPath>
      )}

      <div className="eyebrow">Early access</div>
      <h2>Get notified when Granite is ready to import your vault.</h2>
      <p className="sub">No spam. One email when we launch, plus an early-access link before anyone else.</p>

      {!success && (
        <form className="signup-form" onSubmit={handleSubmit}>
          <div className="email-row">
            <input
              type="email"
              placeholder="you@email.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="submit-btn" disabled={submitting}>
              {submitting ? "Joining..." : "Join waitlist"}
            </button>
          </div>
          {error && <span className="form-error show">{error}</span>}
          <span className="picker-label">Taking notes in — optional</span>
          <div className="platform-picker">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={"platform-chip" + (platform === p.id ? " selected" : "")}
                onClick={() => setPlatform(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </form>
      )}

      {success && (
        <div className="success-msg show">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>{success}</span>
        </div>
      )}
    </section>
  )
}
