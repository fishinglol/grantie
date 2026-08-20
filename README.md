# conflict-cleaner

## The problem

When a notes vault (Obsidian, Joplin, or a plain Markdown folder) is synced across
devices with Syncthing, Google Drive, or OneDrive, and two devices edit the same
file before syncing, the sync tool gives up on merging and leaves a duplicate file
with a mangled name instead — things like:

```
daily-note.sync-conflict-20260815-093012-ABCDEFG.md
daily-note (Conflicted copy 2026-08-15).md
daily-note (DESKTOP-AB12CD3's conflicted copy 2026-08-15).md
```

Over months of syncing across a few devices, these pile up — a dozen, then
fifty, scattered through nested folders. You don't know which copy is current,
and you're afraid to delete any of them in case it's the one with the edits
you actually want.

## What this tool does

`conflict-cleaner` scans a folder for these conflict files, shows you exactly
what differs between each one and its original, and lets you decide what to
keep — one file at a time.

**What it does not do:**

- It does not merge conflicting content automatically. You decide.
- It does not sync anything, or talk to Syncthing, Google Drive, or OneDrive.
- It does not watch your folder in real time — you run it, it reports, you act.
- It has no plugins, no config file, no GUI.

## Safety

- **Dry run by default.** Just running `conflict-cleaner <path>` scans and
  shows you diffs. Nothing is written until you pass `--apply`.
- **Every file is backed up** before it's modified or deleted, into
  `.conflict-cleaner-backup/` (or wherever `--backup-dir` points), preserving
  the folder structure and original timestamps.
- **Nothing happens without your say-so.** Each conflict is resolved one at a
  time, interactively. There is no batch or auto mode.
- It will refuse to delete the last remaining copy of a note.

That said: **back up your vault yourself before running this with `--apply`**,
the same way you would before any tool that touches years of notes. This tool
is careful, but a second, independent backup costs you nothing.

## Install and usage

No dependencies — standard library only. Clone and run:

```bash
git clone https://github.com/fishinglol/grantie.git && cd grantie && python3 -m conflict_cleaner ~/path/to/your/vault
```

Or install it as a command:

```bash
pip install git+https://github.com/fishinglol/grantie.git
conflict-cleaner ~/path/to/your/vault
```

Once you've reviewed the diffs and are ready to resolve them:

```bash
conflict-cleaner ~/path/to/your/vault --apply
```

Other flags:

| Flag | Behavior |
|---|---|
| `--apply` | Enable interactive resolution and actual file writes |
| `--backup-dir <path>` | Where backups go (default: `.conflict-cleaner-backup/`) |
| `--include-hidden` | Also scan dotfolders (off by default) |
| `--json` | Machine-readable scan output (implies dry run) |

## Who made this and why

I hit this exact problem in my own vault — a folder synced across a laptop and
a phone that had quietly accumulated `sync-conflict` files for over a year. I
didn't trust myself to `rm` them without reading each one first, and there
wasn't a small, trustworthy tool that just showed me the diffs and got out of
the way. So I wrote one.

---

I'm also building a notes app designed around this problem from the ground up.
If that's interesting, there's a waitlist here: TODO-add-waitlist-link.
