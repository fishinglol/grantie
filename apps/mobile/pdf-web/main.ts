import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// Bundled worker: it registers itself on `globalThis.pdfjsWorker`, which pdf.js then runs on the main thread.
// The page is an HTML string, so there is no URL to load a worker file from (an empty `workerSrc` throws).
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

const appEl = document.getElementById('app')!;

function showStatus(text: string, isError = false) {
  appEl.innerHTML = `<div class="status-msg ${isError ? 'status-error' : ''}">${escapeHtml(text)}</div>`;
}

let chunks: Uint8Array[] = [];
let totalChunks = 0;
let receivedChunks = 0;

async function renderPdf(bytes: Uint8Array) {
  try {
    showStatus('Reading PDF pages…');
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;

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

    // Create page shells
    for (let i = 1; i <= numPages; i++) {
      const section = document.createElement('section');
      section.className = 'page-section';
      section.id = `page-${i}`;
      section.setAttribute('data-page', String(i));

      const label = document.createElement('div');
      label.className = 'page-label';
      label.textContent = `p. ${i}`;
      section.appendChild(label);

      const body = document.createElement('div');
      body.className = 'page-body';
      body.id = `page-body-${i}`;
      body.innerHTML = '<div class="page-loading">Loading page…</div>';
      section.appendChild(body);

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
            const warning = document.createElement('div');
            warning.className = 'pdf-warning';
            warning.textContent = 'This PDF has no selectable text (it may be a scanned image).';
            container.insertBefore(warning, container.firstChild);
          }
        }
      } catch (err) {
        bodyEl.innerHTML = `<div class="empty-page-text status-error">Error loading page ${pageNum}</div>`;
      }
    };

    // Lazy load observer: loads page content when approaching viewport
    const renderObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.getAttribute('data-page') || '0', 10);
            if (pageNum > 0) void loadPage(pageNum);
          }
        }
      },
      { rootMargin: '400px 0px' }
    );

    // Visible page observer: reports visible page to app
    let lastReportedPage = 1;
    const pageObserver = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0;
        let visiblePage = lastReportedPage;
        for (const entry of entries) {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            visiblePage = parseInt(entry.target.getAttribute('data-page') || '1', 10);
          }
        }
        if (visiblePage !== lastReportedPage && maxRatio > 0.1) {
          lastReportedPage = visiblePage;
          send({ type: 'page', page: visiblePage });
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1.0] }
    );

    const sections = container.querySelectorAll<HTMLElement>('.page-section');
    sections.forEach((sec) => {
      renderObserver.observe(sec);
      pageObserver.observe(sec);
    });

    // Eagerly load the first 2 pages
    void loadPage(1);
    if (numPages >= 2) void loadPage(2);

    send({ type: 'loaded', numPages });
  } catch (err) {
    showStatus(`Failed to load PDF: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

type InboundMessage =
  | { type: 'pdf-meta'; totalChunks: number; byteLength: number }
  | { type: 'pdf-chunk'; index: number; data: string }
  | { type: 'pdf-error'; message: string };

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
  }
}

// A quick swipe to the right anywhere on the page asks the app to open the sidebar, like on a note (editor-web/main.tsx).
let swipe: { x: number; y: number; time: number } | null = null;
document.addEventListener(
  'touchstart',
  (e) => {
    const t = e.touches[0];
    swipe = !t || e.touches.length !== 1 ? null : { x: t.clientX, y: t.clientY, time: Date.now() };
  },
  { passive: true },
);
document.addEventListener(
  'touchend',
  (e) => {
    const t = e.changedTouches[0];
    const s = swipe;
    swipe = null;
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    // Fast, mostly horizontal, and not while text is selected (dragging a selection is not a swipe).
    if (dx > 80 && Math.abs(t.clientY - s.y) < dx * 0.4 && Date.now() - s.time < 400 && window.getSelection()?.isCollapsed !== false) {
      send({ type: 'swipe-right' });
    }
  },
  { passive: true },
);
document.addEventListener('touchcancel', () => (swipe = null), { passive: true });

window.addEventListener('message', onMessage);
document.addEventListener('message', onMessage);

// Signal to host that reader page is ready to receive data
send({ type: 'ready' });
