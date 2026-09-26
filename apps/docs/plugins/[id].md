---
title: Plugin
---

<script setup>
import { useData } from "vitepress";
import { useInstallCounts } from "../.vitepress/installCounts";
const { params } = useData();
const counts = useInstallCounts();
</script>

<div class="plugin-page">

# {{ params.name }} <span v-if="params.soon" class="plugin-soon">SOON</span>

<p class="plugin-tagline">{{ params.tagline }}</p>

<p class="plugin-meta">
  <span>v{{ params.version }}</span>
  <span v-if="params.author">by <a v-if="params.homepage" :href="params.homepage" target="_blank" rel="noopener noreferrer nofollow">{{ params.author }}</a><template v-else>{{ params.author }}</template></span>
  <span v-else-if="params.homepage"><a :href="params.homepage" target="_blank" rel="noopener noreferrer nofollow">Author's page</a></span>
  <span v-if="counts[params.id]">{{ counts[params.id].toLocaleString() }} installs</span>
  <span v-if="params.desktopOnly">Desktop only</span>
</p>

<div class="plugin-shots">
  <img v-for="(src, i) in params.screenshots" :key="src" :src="src" :alt="`${params.name} screenshot ${i + 1}`" loading="lazy" />
</div>

<p v-if="params.description">{{ params.description }}</p>

## Install

<p v-if="params.soon">This plugin isn't installable yet.</p>
<p v-else>In Granite open <strong>Plugins → Store</strong> and choose <strong>{{ params.name }}</strong>. Don't have Granite yet? <a href="https://grantie.vercel.app">Get Granite</a>.</p>

<template v-if="params.setup.length">

## Before you start

<ol><li v-for="step in params.setup" :key="step">{{ step }}</li></ol>

</template>

## What it can do

It asks for these permissions, and nothing else. You see the same list before switching it on.

<ul>
  <li v-for="line in params.permissions" :key="line">{{ line }}</li>
  <li v-for="host in params.connect" :key="host">Connect to {{ host }}</li>
  <li v-if="!params.permissions.length && !params.connect.length">Nothing — it needs no permissions.</li>
</ul>

<p><a href="/plugins/">← All plugins</a></p>

</div>

<style>
.plugin-tagline { font-size: 18px; color: var(--vp-c-text-2); margin: 0 0 8px; }
.plugin-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--vp-c-text-3); font-size: 14px; margin: 0 0 20px; }
.plugin-shots { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 20px; }
.plugin-shots img { flex: none; height: 300px; width: auto; max-width: none; border-radius: 10px; border: 1px solid var(--vp-c-divider); margin: 0; }
.plugin-soon { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: var(--vp-c-default-soft); color: var(--vp-c-text-2); vertical-align: middle; }
</style>
