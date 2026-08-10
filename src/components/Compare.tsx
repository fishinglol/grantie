export default function Compare() {
  return (
    <section className="section compare" id="compare">
      <div className="wrap">
        <div className="eyebrow" style={{ color: "var(--lichen)" }}>
          The gap in the market
        </div>
        <div className="title">Every option makes you give something up.</div>

        <div className="table-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th>
                  <span className="sr">Capability</span>
                </th>
                <th>Obsidian</th>
                <th>Joplin</th>
                <th className="col-granite">Granite</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Free multi-cloud sync</td>
                <td>
                  <span className="mark n">✕</span>
                  <span className="note">paid Sync add-on</span>
                </td>
                <td>
                  <span className="mark y">✓</span>
                </td>
                <td className="cell-granite">
                  <span className="mark y">✓</span>
                </td>
              </tr>
              <tr>
                <td>Polished mobile UI</td>
                <td>
                  <span className="mark y">✓</span>
                </td>
                <td>
                  <span className="mark n">✕</span>
                  <span className="note">community-flagged</span>
                </td>
                <td className="cell-granite">
                  <span className="mark y">✓</span>
                </td>
              </tr>
              <tr>
                <td>Choose your own cloud</td>
                <td>
                  <span className="mark n">✕</span>
                  <span className="note">locked to Obsidian Sync</span>
                </td>
                <td>
                  <span className="mark y">✓</span>
                  <span className="note">WebDAV / Dropbox</span>
                </td>
                <td className="cell-granite">
                  <span className="mark y">✓</span>
                </td>
              </tr>
              <tr>
                <td>One-drag import</td>
                <td>
                  <span className="mark n">—</span>
                </td>
                <td>
                  <span className="mark n">—</span>
                </td>
                <td className="cell-granite">
                  <span className="mark y">✓</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
