---
layout: home
title: Build a plugin
description: Build a plugin for Granite. One JavaScript file for desktop and phone, listed on its own page with your name on it.

hero:
  name: Build for Granite
  text: Make something people use inside their notes
  tagline: Granite is opening in beta. Plugins built now are there from day one. One JavaScript file, no native code, the same on desktop and phone.
  image:
    src: /logo.png
    alt: Granite
  actions:
    - theme: brand
      text: Build your first plugin
      link: /guide/getting-started
    - theme: alt
      text: See what others built
      link: /plugins/
    - theme: alt
      text: Submit a plugin
      link: /guide/publishing

features:
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
    title: One file, two platforms
    details: Write plain JavaScript once. It runs inside the desktop app and the phone app, with no separate builds and no native code.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>'
    title: A small API that is easy to learn
    details: Commands, your own blocks inside a note, typing and paste hooks, link chips, a header button and window, and vault read and write.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
    title: Trusted because it is sandboxed
    details: Your plugin runs in an isolated frame and only gets what its manifest declares. People see that list before they turn it on, so they can say yes with confidence.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
    title: A page of your own
    details: Every listed plugin gets a public page with your screenshots, your name and a link to your site. Share it anywhere and it previews with your first screenshot.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>'
    title: See how many install it
    details: The Store counts installs for each plugin and shows the number on your page and in the app.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>'
    title: Reviewed and open
    details: Granite is open source. You add your plugin with a pull request and a maintainer reads the code. Listed plugins carry that trust.
---

## How it works

<div class="vp-doc build-steps">

1. **Write it.** A folder with a `manifest.json` and a `main.js`. The [Getting started](/guide/getting-started) guide has a working plugin you can copy, and the [API reference](/api/) covers everything the `granite` object can do.
2. **Try it in your own vault.** Drop the folder into `.granite/plugins/` and switch it on in the Plugins screen. No build step.
3. **Send it in.** Open a pull request that adds your plugin, with at least three screenshots and a short README. See [Publishing to the Store](/guide/publishing).
4. **Get listed.** Once it is reviewed and merged, your plugin appears in the Store with its own page, and people can install it from the app.

</div>

## Ideas that fit

A spreadsheet in a note. A calendar that reads your dates. A board of cards. Smart link chips. The [example plugins](/guide/examples) are real and open, so start from one that is close to what you want.

<p class="build-cta">
  <a class="build-btn brand" href="/guide/getting-started">Build your first plugin</a>
  <a class="build-btn" href="/plugins/">Browse the Store</a>
</p>

<style>
.build-steps ol { padding-left: 1.2em; }
.build-steps li { margin: 10px 0; line-height: 1.7; }
.build-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.build-btn { display: inline-block; padding: 0 20px; line-height: 38px; border-radius: 20px; font-size: 14px; font-weight: 600; text-decoration: none !important; background: var(--vp-button-alt-bg); color: var(--vp-button-alt-text) !important; }
.build-btn:hover { background: var(--vp-button-alt-hover-bg); }
.build-btn.brand { background: var(--vp-button-brand-bg); color: var(--vp-button-brand-text) !important; }
.build-btn.brand:hover { background: var(--vp-button-brand-hover-bg); }
</style>
