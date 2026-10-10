import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// Bundled worker: it registers itself on `globalThis.pdfjsWorker`, which pdf.js then runs on the main thread.
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
import { extractPageText, type TextItem } from '@granite/core-notes';
import './reader.css';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    graniteBridgeKey?: string;
  }
}

const send = (message: object) => {
  const payload = JSON.stringify({ ...message, key: window.graniteBridgeKey });
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(payload);
  } else if (window.parent && window.parent !== window) {
    window.parent.postMessage(payload, '*');
  }
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function concatChunks(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (let i = 0; i < parts.length; i++) len += parts[i]!.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i]!, offset);
    offset += parts[i]!.length;
  }
  return out;
}

export interface TocItem {
  id: string;
  title: string;
  page: number;
  level: number;
}

async function resolveDestPage(doc: any, dest: any): Promise<number | null> {
  if (!dest || !doc) return null;
  try {
    let explicit = dest;
    if (typeof dest === 'string') explicit = await doc.getDestination(dest);
    if (Array.isArray(explicit) && explicit.length > 0) {
      const ref = explicit[0];
      if (typeof ref === 'number') return ref + 1;
      if (ref && typeof ref === 'object') {
        const idx = await doc.getPageIndex(ref);
        if (typeof idx === 'number' && idx >= 0) return idx + 1;
      }
    }
  } catch {
    // resolution error
  }
  return null;
}

async function extractOutline(doc: any): Promise<TocItem[]> {
  if (!doc || typeof doc.getOutline !== 'function') return [];
  try {
    const raw = await doc.getOutline();
    if (!raw || !Array.isArray(raw) || raw.length === 0) return [];
    const items: TocItem[] = [];
    let counter = 0;

    async function walk(nodes: any[], level: number, fallback: number) {
      for (const node of nodes) {
        if (!node || typeof node.title !== 'string') continue;
        const resolved = await resolveDestPage(doc, node.dest);
        const page = resolved ?? fallback;
        const id = `toc-${++counter}-${page}`;
        items.push({ id, title: node.title.trim(), page, level });
        if (Array.isArray(node.items) && node.items.length > 0) {
          await walk(node.items, level + 1, page);
        }
      }
    }

    await walk(raw, 0, 1);
    return items;
  } catch {
    return [];
  }
}

export interface SearchMatch {
  id: string;
  page: number;
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
}

function buildCleanText(items: any[]): string {
  if (!items || items.length === 0) return '';
  let out = '';
  let prev: any = null;
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    if (prev) {
      if (prev.hasEOL) {
        out += '\n';
      } else {
        const prevY = Array.isArray(prev.transform) ? prev.transform[5] : 0;
        const curY = Array.isArray(item.transform) ? item.transform[5] : 0;
        if (Math.abs(curY - prevY) > 3) {
          out += '\n';
        } else {
          const prevX = Array.isArray(prev.transform) ? prev.transform[4] : 0;
          const prevW = typeof prev.width === 'number' ? prev.width : 0;
          const curX = Array.isArray(item.transform) ? item.transform[4] : 0;
          const gap = curX - (prevX + prevW);
          const hasSpace = prev.str.endsWith(' ') || item.str.startsWith(' ');
          if (!hasSpace && gap > 1.8) out += ' ';
        }
      }
    }
    out += item.str;
    prev = item;
  }
  return out;
}

const pageTextCache = new Map<number, string>();

async function getCachedPageText(doc: any, pageNum: number): Promise<string> {
  const cached = pageTextCache.get(pageNum);
  if (cached !== undefined) return cached;
  try {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const raw = buildCleanText(content.items || []);
    page.cleanup?.();
    const norm = raw.normalize('NFKC').replace(/[ \t]+/g, ' ');
    pageTextCache.set(pageNum, norm);
    return norm;
  } catch {
    pageTextCache.set(pageNum, '');
    return '';
  }
}

async function searchInPdf(doc: any, query: string): Promise<SearchMatch[]> {
  const q = query.trim().normalize('NFKC').toLowerCase();
  if (!doc || !q || q.length < 2) return [];
  const numPages: number = doc.numPages ?? 0;
  const results: SearchMatch[] = [];
  const PAD = 35;

  for (let page = 1; page <= numPages; page++) {
    const text = await getCachedPageText(doc, page);
    if (!text) continue;
    const lower = text.toLowerCase();
    let idx = 0;
    let matchIdx = 0;
    while ((idx = lower.indexOf(q, idx)) !== -1) {
      const start = Math.max(0, idx - PAD);
      const end = Math.min(text.length, idx + q.length + PAD);
      const before = (start > 0 ? '…' : '') + text.slice(start, idx).trimStart().replace(/\s+/g, ' ');
      const match = text.slice(idx, idx + q.length);
      const after = text.slice(idx + q.length, end).trimEnd().replace(/\s+/g, ' ') + (end < text.length ? '…' : '');

      results.push({
        id: `m-${page}-${matchIdx++}-${idx}`,
        page,
        snippetBefore: before,
        snippetMatch: match,
        snippetAfter: after,
      });

      idx += q.length;
      if (results.length >= 100) return results;
    }
  }
  return results;
}

const appEl = document.getElementById('app')!;

function showStatus(text: string, isError = false) {
  appEl.innerHTML = `<div class="status-msg ${isError ? 'status-error' : ''}">${escapeHtml(text)}</div>`;
}

let activePdfDoc: any = null;
let goToPage: ((n: number, instant?: boolean) => void) | null = null;
let pendingGoto: { page: number; instant: boolean } | null = null;
let chunks: Uint8Array[] = [];
let totalChunks = 0;
let receivedChunks = 0;
let lastReportedPage = 1;
let totalPagesCount = 1;

async function renderPdf(bytes: Uint8Array) {
  try {
    showStatus('Reading PDF pages…');
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    activePdfDoc = pdf;
    const numPages = pdf.numPages;
    totalPagesCount = numPages;

    if (numPages === 0) {
      showStatus('This PDF has no pages.');
      return;
    }

    appEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'pdf-container';
    appEl.appendChild(container);

    const loadedPages = new Set<number>();
    const pageEmptyState = new Map<number, boolean>();

    // Extract table of contents in background
    void extractOutline(pdf).then((toc) => {
      send({ type: 'outline', toc });
    });

    // Create single-page card shells (horizontal snap)
    for (let i = 1; i <= numPages; i++) {
      const section = document.createElement('section');
      section.className = 'page-section';
      section.id = `page-${i}`;
      section.setAttribute('data-page', String(i));

      // Page Header
      const header = document.createElement('div');
      header.className = 'page-header';
      header.innerHTML = `<span>Page ${i}</span><span>${Math.round((i / numPages) * 100)}%</span>`;
      section.appendChild(header);

      // Page Body
      const body = document.createElement('div');
      body.className = 'page-body';
      body.id = `page-body-${i}`;
      body.innerHTML = '<div class="page-loading">Loading page…</div>';
      section.appendChild(body);

      // Page Footer (Google Play Books style: progress left and percentage right)
      const footer = document.createElement('div');
      footer.className = 'page-footer';
      footer.innerHTML = `
        <span class="page-footer-left">p. ${i} of ${numPages}</span>
        <span class="page-footer-right">${Math.round((i / numPages) * 100)}%</span>
      `;
      section.appendChild(footer);

      container.appendChild(section);
    }

    // Function to load and render page text
    const loadPage = async (pageNum: number) => {
      if (loadedPages.has(pageNum)) return;
      loadedPages.add(pageNum);
      const bodyEl = document.getElementById(`page-body-${pageNum}`);
      if (!bodyEl) return;

      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = extractPageText(pageNum, textContent.items as unknown as TextItem[]);
        pageEmptyState.set(pageNum, pageText.empty);

        bodyEl.innerHTML = '';
        if (pageText.empty || pageText.paragraphs.length === 0) {
          const emptyDiv = document.createElement('div');
          emptyDiv.className = 'empty-page-text';
          emptyDiv.textContent = '[No selectable text on this page]';
          bodyEl.appendChild(emptyDiv);
        } else {
          for (const para of pageText.paragraphs) {
            const p = document.createElement('p');
            p.className = 'paragraph';
            p.textContent = para.text;
            bodyEl.appendChild(p);
          }
        }

        // Check if all pages loaded and all are empty
        if (loadedPages.size === numPages) {
          let hasAnyText = false;
          for (const isEmpty of pageEmptyState.values()) {
            if (!isEmpty) {
              hasAnyText = true;
              break;
            }
          }
          if (!hasAnyText) {
            const firstBody = document.getElementById('page-body-1');
            if (firstBody) {
              const warning = document.createElement('div');
              warning.className = 'pdf-warning';
              warning.textContent = 'This PDF has no selectable text (it may be a scanned image).';
              firstBody.insertBefore(warning, firstBody.firstChild);
            }
          }
        }
      } catch {
        bodyEl.innerHTML = `<div class="empty-page-text status-error">Error loading page ${pageNum}</div>`;
      }
    };

    // Lazy load observer: loads page content when approaching horizontal viewport
    try {
      const renderObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const pageNum = parseInt(entry.target.getAttribute('data-page') || '0', 10);
              if (pageNum > 0) void loadPage(pageNum);
            }
          }
        },
        { root: container, rootMargin: '0px 200% 0px 200%' }
      );

      const sections = container.querySelectorAll<HTMLElement>('.page-section');
      sections.forEach((sec) => renderObserver.observe(sec));
    } catch {
      // Fallback if IntersectionObserver fails: eager load initial pages
      void loadPage(1);
      if (numPages >= 2) void loadPage(2);
      if (numPages >= 3) void loadPage(3);
    }

    // Eagerly load the first 2 pages
    void loadPage(1);
    if (numPages >= 2) void loadPage(2);

    // Track active page on horizontal scroll
    let scrollTimeout: any = null;
    container.addEventListener(
      'scroll',
      () => {
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          const width = container.clientWidth || window.innerWidth;
          const page = Math.min(numPages, Math.max(1, Math.round(container.scrollLeft / width) + 1));
          if (page !== lastReportedPage) {
            lastReportedPage = page;
            void loadPage(page);
            if (page > 1) void loadPage(page - 1);
            if (page < numPages) void loadPage(page + 1);
            send({ type: 'page', page });
          }
        }, 60);
      },
      { passive: true }
    );

    // Jump to specific page
    goToPage = (n: number, instant: boolean = false) => {
      const page = Math.min(Math.max(1, Math.round(n)), numPages);
      lastReportedPage = page;
      void loadPage(page);
      if (page > 1) void loadPage(page - 1);
      if (page < numPages) void loadPage(page + 1);

      const width = container.clientWidth || window.innerWidth;
      container.scrollTo({ left: (page - 1) * width, behavior: instant ? 'auto' : 'smooth' });
      send({ type: 'page', page });
    };

    if (pendingGoto !== null) goToPage(pendingGoto.page, pendingGoto.instant);
    pendingGoto = null;

    send({ type: 'loaded', numPages });
  } catch (err) {
    showStatus(`Failed to load PDF: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

type InboundMessage =
  | { type: 'pdf-meta'; totalChunks: number; byteLength: number }
  | { type: 'pdf-chunk'; index: number; data: string }
  | { type: 'pdf-error'; message: string }
  | { type: 'goto'; page: number; instant?: boolean }
  | { type: 'next-page' }
  | { type: 'prev-page' }
  | { type: 'search'; query: string; searchId: number }
  | { type: 'set-display'; options: { fontSize?: number; fontFamily?: string; lineHeight?: number; theme?: string } };

function onMessage(event: Event) {
  const source = (event as MessageEvent).source;
  if (source !== null && source !== window.parent) return;

  let msg: InboundMessage;
  try {
    msg = JSON.parse((event as MessageEvent<string>).data) as InboundMessage;
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'pdf-meta') {
    totalChunks = msg.totalChunks;
    chunks = new Array(totalChunks);
    receivedChunks = 0;
    showStatus('Receiving PDF data…');
  } else if (msg.type === 'pdf-chunk') {
    chunks[msg.index] = b64ToUint8(msg.data);
    receivedChunks++;
    if (receivedChunks === totalChunks) {
      const bytes = concatChunks(chunks);
      chunks = [];
      void renderPdf(bytes);
    }
  } else if (msg.type === 'pdf-error') {
    showStatus(msg.message, true);
  } else if (msg.type === 'goto' && Number.isFinite(msg.page)) {
    const instant = !!msg.instant;
    if (goToPage) goToPage(msg.page, instant);
    else pendingGoto = { page: msg.page, instant };
  } else if (msg.type === 'next-page') {
    if (goToPage) goToPage(lastReportedPage + 1);
  } else if (msg.type === 'prev-page') {
    if (goToPage) goToPage(lastReportedPage - 1);
  } else if (msg.type === 'search') {
    if (activePdfDoc) {
      void searchInPdf(activePdfDoc, msg.query).then((results) => {
        send({ type: 'search-results', searchId: msg.searchId, results });
      });
    } else {
      send({ type: 'search-results', searchId: msg.searchId, results: [] });
    }
  } else if (msg.type === 'set-display') {
    const root = document.documentElement;
    const { fontSize, fontFamily, lineHeight, theme } = msg.options;
    if (fontSize) root.style.setProperty('--reader-font-size', `${fontSize}px`);
    if (fontFamily) root.style.setProperty('--reader-font-family', fontFamily);
    if (lineHeight) root.style.setProperty('--reader-line-height', String(lineHeight));
    if (theme) root.setAttribute('data-theme', theme);
  }
}

// Touch gesture handler:
// 1. Single tap on center 70% -> send 'toggle-controls'
// 2. Single tap on left 15% -> previous page
// 3. Single tap on right 15% -> next page
// 4. Swipe right on page 1 -> open sidebar
let touchStart: { x: number; y: number; time: number } | null = null;

document.addEventListener(
  'touchstart',
  (e) => {
    const t = e.touches[0];
    if (t && e.touches.length === 1) {
      touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    } else {
      touchStart = null;
    }
  },
  { passive: true }
);

document.addEventListener(
  'touchend',
  (e) => {
    const t = e.changedTouches[0];
    const start = touchStart;
    touchStart = null;
    if (!start || !t) return;

    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const duration = Date.now() - start.time;

    // Check if dragging or text selection
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return;

    // Fast swipe right from left edge on page 1 -> open sidebar
    if (lastReportedPage === 1 && dx > 80 && Math.abs(dy) < dx * 0.4 && duration < 400 && start.x < 60) {
      send({ type: 'swipe-right' });
      return;
    }

    // Clean tap: little movement and short duration
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && duration < 320) {
      const screenW = window.innerWidth;
      const x = t.clientX;

      if (x < screenW * 0.15) {
        // Tap left edge -> previous page
        if (goToPage && lastReportedPage > 1) {
          goToPage(lastReportedPage - 1);
        }
      } else if (x > screenW * 0.85) {
        // Tap right edge -> next page
        if (goToPage && lastReportedPage < totalPagesCount) {
          goToPage(lastReportedPage + 1);
        }
      } else {
        // Tap center -> toggle reader controls
        send({ type: 'toggle-controls' });
      }
    }
  },
  { passive: true }
);

document.addEventListener('touchcancel', () => (touchStart = null), { passive: true });

window.addEventListener('message', onMessage);
document.addEventListener('message', onMessage);

// Signal to host that reader page is ready to receive data
send({ type: 'ready' });
