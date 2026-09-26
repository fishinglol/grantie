---
layout: home

hero:
  name: Granite Plugins
  text: Build a plugin for Granite
  tagline: One JavaScript file. Sandboxed. Runs the same on desktop and phone.
  image:
    src: /logo.png
    alt: Granite
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: API reference
      link: /api/
    - theme: alt
      text: Browse examples
      link: /guide/examples

features:
  - icon: 🧩
    title: One language, both platforms
    details: Plugins are plain JavaScript. The same file runs inside the desktop app and the phone app — no native code, no separate builds.
  - icon: 🔒
    title: Sandboxed by default
    details: Every plugin runs in an isolated frame with no access to the app, your files, or the network unless its manifest declares that permission — and the person installing it sees the list before turning it on.
  - icon: 🛠️
    title: A small, versioned API
    details: Commands, editor access, your own blocks inside a note, typing/paste hooks, link chips, a header button and window, and vault read/write. Each surface is its own permission.
  - icon: 📦
    title: Reviewed, not open upload
    details: Granite's Store only lists plugins whose code has been reviewed. Contributing means opening a pull request — see Publishing to the Store.
---
