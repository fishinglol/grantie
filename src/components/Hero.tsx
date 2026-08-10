import ImportDemo from "./ImportDemo"

export default function Hero() {
  return (
    <section className="hero">
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
