# Memory Bank

Persistent project knowledge so any AI agent (or teammate) can pick up context
across sessions. Read these in order at the start of a session; update
`activeContext.md` and `progress.md` at the end of one.

| File | Holds | Update frequency |
| --- | --- | --- |
| `projectbrief.md` | Foundation — what Granite is, goals, scope, non-goals (source of truth) | rarely |
| `productContext.md` | Why Granite exists, the problem it solves, target user | rarely |
| `systemPatterns.md` | Architecture + design patterns in use | on architecture changes |
| `techContext.md` | Tech stack, setup, tooling, dependencies | on stack changes |
| `activeContext.md` | What we're working on right now, open decisions | every session |
| `progress.md` | What's done, what's left, known issues | every session |
| `pluginDesign.md` | Plugin system (TS/JS, desktop + phone): original design, what is built (API v1, v2 input hooks, v3 `vault.open`), risks, open decisions | when the plugin system changes |
| `securityReport.md` | Security review before the beta: findings, fixes, what is still open, how each was verified | after security work |
