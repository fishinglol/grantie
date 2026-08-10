import CloudIcon, { CLOUD_IDS } from "./CloudIcon"

export default function Pillars() {
  return (
    <section className="section pillars">
      <div className="wrap">
        <div className="eyebrow">Why Granite</div>
        <div className="title">
          Three things every other note app makes you choose between. <em>We didn't.</em>
        </div>

        <div className="pillar-grid">
          <div className="pillar">
            <div className="pillar-mark">
              {CLOUD_IDS.map((id) => (
                <CloudIcon key={id} id={id} className="cloud" />
              ))}
            </div>
            <h3>Bring your own cloud</h3>
            <p>
              Connect Drive, Dropbox, OneDrive, or iCloud — whichever you already pay for.
              No separate sync subscription, no third-party app running in the background
              just to keep your phone up to date.
            </p>
            <span className="tag">multi-cloud, native</span>
          </div>

          <div className="pillar">
            <div className="pillar-mark">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 3V15M12 15L8 11M12 15L16 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 15V17.8C4 18.92 4 19.48 4.22 19.91C4.41 20.28 4.72 20.59 5.09 20.78C5.52 21 6.08 21 7.2 21H16.8C17.92 21 18.48 21 18.91 20.78C19.28 20.59 19.59 20.28 19.78 19.91C20 19.48 20 18.92 20 17.8V15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Import without losing anything</h3>
            <p>
              Drag in your Obsidian vault, Joplin notebook, or Notion export. Links stay
              linked, folders stay folders, attachments stay attached. Nothing to rebuild
              by hand.
            </p>
            <span className="tag">from Obsidian, Joplin, Notion</span>
          </div>

          <div className="pillar">
            <div className="pillar-mark">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="6" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="17.5" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="12" cy="16.5" r="2.6" stroke="currentColor" strokeWidth="1.4" />
                <path d="M7.7 8.7L10.6 14.3M15.9 7.2L13.4 14.6M8.2 6.2L15.6 5.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <h3>Everything you need, none of the lock-in</h3>
            <p>
              Backlinks, graph view, folders, tags, plain Markdown files on disk. All the
              depth you'd expect from a serious notes app — we just fixed sync.
            </p>
            <a href="#compare" className="tag">
              see full comparison →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
