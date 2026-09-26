---
title: Plugins
description: Plugins for Granite — each one reviewed before it is listed.
---

<script setup>
import registry from "../api/_registry.json";
import { useInstallCounts } from "../.vitepress/installCounts";
const counts = useInstallCounts();
</script>

# Plugins

Every plugin here has had its code read before it was listed, runs in a sandbox, and shows exactly what it
asks to do. Install one from **Granite → Plugins → Store**. Want yours here? See
[Publishing to the Store](/guide/publishing).

<div class="plugin-grid">
  <a v-for="p in registry" :key="p.id" class="plugin-card" :href="`/plugins/${p.id}`">
    <img :src="p.screenshots[0]" :alt="`${p.name} screenshot`" loading="lazy" />
    <div class="plugin-card-body">
      <strong>{{ p.name }}</strong>
      <span v-if="p.soon" class="plugin-soon">SOON</span>
      <p>{{ p.tagline }}</p>
      <small v-if="counts[p.id]">{{ counts[p.id].toLocaleString() }} installs</small>
    </div>
  </a>
</div>

<style>
.plugin-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-top: 24px; }
.vp-doc a.plugin-card { font-weight: 400; text-decoration: none; }
.plugin-card-body strong { color: var(--vp-c-text-1); }
.plugin-card { display: block; border: 1px solid var(--vp-c-divider); border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; background: var(--vp-c-bg-soft); transition: border-color .2s; }
.plugin-card:hover { border-color: var(--vp-c-brand-1); }
.plugin-card img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; background: var(--vp-c-bg-alt); margin: 0; }
.plugin-card-body { padding: 12px 14px 14px; }
.plugin-card-body p { margin: 4px 0 6px; font-size: 14px; color: var(--vp-c-text-2); line-height: 1.5; }
.plugin-card-body small { color: var(--vp-c-text-3); }
.plugin-soon { margin-left: 6px; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--vp-c-default-soft); color: var(--vp-c-text-2); }
</style>
