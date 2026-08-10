import { useEffect, useState } from "react"
import { Cloud, FileText, FolderTree, Link2, RefreshCw } from "lucide-react"
import MarqueeAlongSvgPath from "./ui/marquee-along-svg-path"
import ImportDemo from "./ImportDemo"

const WAVE_PATH =
  "M0 260 C 200 160, 400 360, 600 220 C 800 80, 1000 320, 1200 180"

const ICONS = [Cloud, FolderTree, FileText, Link2, RefreshCw]

export default function Hero() {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduceMotion(mq.matches)
    const onChange = () => setReduceMotion(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return (
    <section className="hero">
      {!reduceMotion && (
        <MarqueeAlongSvgPath
          path={WAVE_PATH}
          viewBox="0 0 1200 400"
          baseVelocity={6}
          repeat={2}
          responsive
          className="hero-marquee"
        >
          {ICONS.map((Icon, i) => (
            <Icon key={i} size={24} strokeWidth={1.5} />
          ))}
        </MarqueeAlongSvgPath>
      )}

      <div className="wrap hero-grid">
        <div>
          <div className="eyebrow">Notes that don't care which cloud you use</div>
          <h1 className="display">
            All your notes.
            <br />
            <em>Any</em> cloud you already pay for.
          </h1>
          <p className="hero-sub">
            A local-first Markdown note app with <strong>native multi-cloud sync</strong> —
            Drive, Dropbox, OneDrive, iCloud. Pick one, no plugins. Bring your existing
            vault across and keep everything: links, folders, files.
          </p>
        </div>

        <ImportDemo />
      </div>
    </section>
  )
}
