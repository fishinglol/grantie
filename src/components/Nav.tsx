import { useEffect, useState } from "react"

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <nav className={scrolled ? "scrolled" : undefined}>
      <a href="#" className="logo">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M4 20L9 6L14 14L17 4L20 20H4Z" fill="currentColor" />
        </svg>
        Granite
      </a>
      <a href="#signup" className="nav-cta">
        Join waitlist
      </a>
    </nav>
  )
}
