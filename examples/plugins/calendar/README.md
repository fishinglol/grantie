# Calendar

Your notes on a calendar, by a date in their properties, on desktop and phone. Three views: a **month**, an endless scroll of
**weeks**, and the whole **year** with one month per row. A note that spans several days shows as one bar.

Based on [Just Simple Calendar](https://github.com/DavidHurtadoAI/just-simple-calendar) by David Hurtado (MIT, see `LICENSE`):
its date math, the layout that gives overlapping notes their own lanes, the three views and their look. What Obsidian did for it
(Bases, opening notes, previews) is done here through Granite's plugin API.

- Permissions: **Draw its own blocks inside your notes** (`editor.blocks`), **Read the open note** and **Change the open note**
  (`editor.read`, `editor.write`, only for the two commands below), **Read your notes** (`vault.read`: to find their dates, and to
  open one) and **Create and change notes** (`vault.write`: only when you create a note from the calendar). No network.
  Needs Granite with plugin API 4 (`minApiVersion`).
- Install: from the **Store** tab of Plugins (desktop or phone), or copy this folder to `<vault>/.granite/plugins/calendar/`
  (it syncs to your other devices), then switch it on under Plugins on each device.

## Put a date on a note

```
---
date: 2026-09-21
end_date: 2026-09-25
---
```

`end_date` is optional and inclusive (21 to 25 is five days). A date and time (`2026-09-21T09:00`) counts as that day. The
property names are yours to choose: change them with ⚙ on the calendar.

## Use

- **⋯ → Turn this page into a calendar** makes the note a full-page calendar. **Insert a calendar** (Plugins screen) puts one
  inside the note you are writing, or type a ```` ```calendar ```` block yourself.
- **Month / Weeks / Year** switch the view. «  ‹  Today  ›  » move by year and month; ↻ reads your notes again (after you
  changed dates elsewhere).
- **Click (tap) a note** to open it. **Double-click an empty day** (on a phone: **long-press** it) to create a note on that day:
  `2026-09-26.md`, with the date already filled in, and it opens. On the desktop the note opens **beside** the calendar (a split view,
  calendar on the left, note on the right; the next note you click replaces the one on the right). On a phone there is no room for two
  halves, so the note opens full screen with a **‹ back** button to the calendar at the top.
- Type **`//`** on an empty line and pick **Calendar** to put one inside the note you are writing.
- **⚙** sets the date property, the end date property, a title property (shown instead of the file name) and whether weeks
  start on Monday or Sunday.

## How it is stored

The calendar's settings are the text of its block, so they sync with the note:

````
```calendar
view: month
date: date
end: end_date
title: 
week: monday
page: 1
```
````

`view` is `month`, `infinite` (weeks) or `linear` (year); `page: 1` means the calendar fills the page.

## Not included

Hover previews, a right-click menu (open in a new tab, delete) and times of day: Granite has no API for the first two yet, and
the original leaves out hours on purpose.
