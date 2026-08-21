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
        <img src="/logo-64.png" alt="" />
        Granite
      </a>
      <a href="#signup" className="nav-cta">
        Join waitlist
      </a>
    </nav>
  )
}
