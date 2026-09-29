// Cursor Effects: draws its own text cursor (and some effects) over the editor with the `editor.caret` API (plugin API 8).
// This one file runs in two frames of the same plugin: the *overlay* (transparent, over the whole window, never online, only
// draws) and the plugin's normal frame (the settings window and the command). `granite.caret.inOverlay` tells them apart.
(() => {
  const DEFAULTS = {
    shape: "line", // "line" | "box" | "underline"
    hollow: false, // box only: an outline instead of a tint
    color: "", // "#rrggbb", or "" for the theme's accent
    thickness: 2, // px: the line's width, the underline's height, the outline's width
    opacity: 1,
    blink: "blink", // "blink" | "smooth" | "solid"
    speed: 1,
    glide: true, // slide to the next position instead of jumping
    trail: false, // pixel trail behind a moving cursor
    dust: false, // dust rising from the cursor as you type
    pop: false, // typed letters float up; deleting bursts
    spot: false, // torch: dim everything but a pool of light around the cursor
  };

  /** Anything that comes from storage or the settings window is untrusted text: keep only what is valid. */
  function clean(o) {
    const r = { ...DEFAULTS };
    if (!o || typeof o !== "object") return r;
    if (["line", "box", "underline"].includes(o.shape)) r.shape = o.shape;
    if (["blink", "smooth", "solid"].includes(o.blink)) r.blink = o.blink;
    if (typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color)) r.color = o.color.toLowerCase();
    const num = (v, lo, hi, fallback) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
    r.thickness = num(o.thickness, 1, 8, r.thickness);
    r.opacity = num(o.opacity, 0.2, 1, r.opacity);
    r.speed = num(o.speed, 0.4, 3, r.speed);
    for (const k of ["hollow", "glide", "trail", "dust", "pop", "spot"]) if (typeof o[k] === "boolean") r[k] = o[k];
    return r;
  }

  // ---- the overlay -------------------------------------------------------------------------------------------------------------------

  function drawOverlay(el, overlay) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let opts = clean(null);
    let last = null; // the caret as last drawn: { x, y, width, height }
    let selecting = false;

    const style = document.createElement("style");
    style.textContent = `
      .c{position:fixed;left:0;top:0;display:none;pointer-events:none;will-change:transform}
      .c.on{display:block}
      .c.glide{transition:transform 85ms cubic-bezier(.2,.8,.3,1)}
      .c.glide .k{transition:width 85ms,height 85ms}
      .k{box-sizing:border-box}
      @keyframes hard{0%,50%{opacity:1}50.01%,100%{opacity:0}}
      @keyframes soft{0%,100%{opacity:1}50%{opacity:.08}}
      canvas{position:fixed;left:0;top:0;width:100%;height:100%}
      .spot{position:fixed;inset:0;display:none;--sx:50%;--sy:50%;--r:80px}
      .spot.on{display:block;background:radial-gradient(circle at var(--sx) var(--sy),transparent 0,transparent var(--r),rgba(0,0,0,.34) calc(var(--r)*2.6),rgba(0,0,0,.62) 100%)}
    `;
    const spot = document.createElement("div");
    spot.className = "spot";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const node = document.createElement("div");
    node.className = "c";
    const inner = document.createElement("div");
    inner.className = "k";
    node.append(inner);
    el.append(style, spot, canvas, node);

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    addEventListener("resize", fit);

    const color = () => opts.color || getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e8871e";

    // The cursor itself: one element that is moved with `transform` (cheap, and it blinks with a CSS animation, so an idle cursor costs nothing).
    function shape(c) {
      const t = opts.thickness;
      inner.style.cssText = "";
      inner.style.opacity = String(opts.shape === "box" && !opts.hollow ? opts.opacity * 0.55 : opts.opacity);
      if (opts.shape === "line") {
        inner.style.width = `${t}px`;
        inner.style.height = `${c.height}px`;
        inner.style.background = color();
      } else if (opts.shape === "box") {
        inner.style.width = `${c.width}px`;
        inner.style.height = `${c.height}px`;
        if (opts.hollow) inner.style.border = `${Math.min(t, 3)}px solid ${color()}`;
        else inner.style.background = color();
      } else {
        inner.style.width = `${c.width}px`;
        inner.style.height = `${t}px`;
        inner.style.background = color();
        inner.style.transform = `translateY(${c.height - t}px)`;
      }
    }

    function restartBlink() {
      node.style.animation = "none";
      if (opts.blink === "solid" || reduce) return;
      void node.offsetWidth; // so the animation starts over from "visible" every time the cursor moves
      const soft = opts.blink === "smooth";
      node.style.animation = `${soft ? "soft" : "hard"} ${1.06 / opts.speed}s ${soft ? "ease-in-out" : "linear"} infinite`;
    }

    function hide() {
      node.classList.remove("on");
      spot.classList.remove("on");
    }

    function place(c, scroll) {
      const prev = last;
      last = c;
      const shown = node.classList.contains("on");
      node.classList.toggle("glide", opts.glide && !reduce && !scroll && shown);
      node.classList.add("on");
      shape(c);
      node.style.transform = `translate(${c.x}px,${c.y}px)`;
      restartBlink();
      if (opts.spot && !reduce) {
        spot.classList.add("on");
        spot.style.setProperty("--sx", `${c.x}px`);
        spot.style.setProperty("--sy", `${c.y + c.height / 2}px`);
        spot.style.setProperty("--r", `${Math.max(40, c.height * 3)}px`);
      } else spot.classList.remove("on");
      if (opts.trail && prev && !scroll && !reduce) trail(prev, c);
    }

    // Effects: small particles on one canvas, with an animation loop that runs only while any are alive.
    const parts = [];
    let raf = 0;
    const spawn = (p) => {
      parts.push({ ...p, t0: performance.now() });
      if (!raf) raf = requestAnimationFrame(tick);
    };
    function tick(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        const age = now - p.t0;
        if (age >= p.life) {
          parts.splice(i, 1);
          continue;
        }
        const f = age / p.life;
        ctx.globalAlpha = (1 - f) * (p.alpha ?? 1);
        ctx.fillStyle = p.color;
        if (p.text) {
          ctx.font = `600 ${p.size}px ui-monospace,Menlo,Consolas,monospace`;
          ctx.fillText(p.text, p.x, p.y - p.rise * (1 - (1 - f) * (1 - f)));
        } else {
          const s = p.size * (1 - f * 0.5);
          ctx.fillRect(p.x + p.vx * age - s / 2, p.y + p.vy * age - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
      raf = parts.length ? requestAnimationFrame(tick) : 0;
    }
    const rand = (a, b) => a + Math.random() * (b - a);
    const midY = (c) => c.y + c.height / 2;

    function trail(a, b) {
      const dist = Math.hypot(b.x - a.x, midY(b) - midY(a));
      if (dist < 2) return;
      const size = Math.max(2, b.height / 5);
      const steps = Math.min(14, Math.ceil(dist / (size * 1.5)));
      for (let i = 0; i < steps; i++) {
        const f = i / steps;
        spawn({ x: a.x + (b.x - a.x) * f, y: midY(a) + (midY(b) - midY(a)) * f, size, vx: rand(-0.01, 0.01), vy: rand(-0.01, 0.01), life: 360, color: color(), alpha: 0.75 });
      }
    }
    function burst(c, count, opts2) {
      for (let i = 0; i < count; i++) {
        spawn({ x: c.x, y: midY(c), size: rand(2.5, 4.5), vx: rand(-opts2.spread, opts2.spread), vy: rand(opts2.up[0], opts2.up[1]), life: rand(520, 900), color: opts2.color, alpha: 0.9 });
      }
    }

    overlay.onOptions((o) => {
      opts = clean(o);
      if (!opts.trail && !opts.dust && !opts.pop) parts.length = 0;
      if (last && !selecting) place(last, true);
    });

    overlay.onCaret((e) => {
      if (e.type === "move") {
        selecting = e.selecting;
        if (!e.caret || e.selecting) return hide();
        return place(e.caret, e.scroll);
      }
      if (!e.caret || reduce) return;
      if (e.type === "type") {
        if (opts.dust) burst(e.caret, 9, { spread: 0.035, up: [-0.1, -0.03], color: color() });
        const ch = e.text.trim().slice(-1);
        if (opts.pop && ch) spawn({ text: ch, x: e.caret.x - e.caret.width, y: e.caret.y + e.caret.height * 0.8, size: e.caret.height * 0.8, rise: e.caret.height * 1.3, life: 650, color: color() });
      } else if (e.type === "delete") {
        if (opts.pop || opts.dust) burst(e.caret, 9, { spread: 0.06, up: [-0.06, 0.03], color: "#9aa0a6" });
      } else if (e.type === "enter") {
        if (opts.pop || opts.dust) burst(e.caret, 14, { spread: 0.14, up: [-0.04, 0.04], color: color() });
      }
    });
  }

  // ---- the settings window ------------------------------------------------------------------------------------------------------------

  const PRESETS = [
    ["Classic", { shape: "line", thickness: 2, blink: "blink", glide: false, trail: false, dust: false, pop: false, spot: false, hollow: false, color: "" }],
    ["Block", { shape: "box", hollow: false, thickness: 2, blink: "smooth", glide: true, trail: false, dust: false, pop: false, spot: false, color: "" }],
    ["Neon", { shape: "line", thickness: 3, blink: "smooth", glide: true, trail: true, dust: true, pop: false, spot: false, hollow: false, color: "#22d3ee" }],
    ["Typewriter", { shape: "underline", thickness: 3, blink: "solid", glide: false, trail: false, dust: false, pop: true, spot: false, hollow: false, color: "" }],
    ["Torch", { shape: "line", thickness: 2, blink: "smooth", glide: true, trail: false, dust: false, pop: false, spot: true, hollow: false, color: "#fbbf24" }],
  ];
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v16M8 4h8M8 20h8"/></svg>';
  const PANEL_CSS = `
    :root{color-scheme:dark light}
    body{padding:14px 16px 18px;box-sizing:border-box}
    h2{margin:0 0 10px;font-size:15px}
    h3{margin:16px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim,#999)}
    .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}
    button,select{font:inherit;color:var(--text);background:var(--panel-hover,#333);border:1px solid var(--border,#444);border-radius:8px;padding:6px 10px;cursor:pointer}
    button.on{background:var(--accent);color:#fff;border-color:transparent}
    label{display:flex;gap:8px;align-items:center;flex:1 1 100%;margin:4px 0}
    label small{display:block;color:var(--text-dim,#999)}
    label.slider{display:grid;grid-template-columns:96px 1fr;gap:10px}
    input{accent-color:var(--accent)}
    input[type=range]{width:100%}
    input[type=color]{width:38px;height:30px;padding:0;border:1px solid var(--border,#444);border-radius:8px;background:none}
    .done{margin-top:16px;width:100%}
  `;

  function main() {
    let opts = clean(null);
    // The editor draws its own text cursor; ours replaces it. Only the note's text: the note's title box keeps its own.
    void granite.editor.setStyle(".live-editor .cm-content{caret-color:transparent !important}");
    void granite.caret.getOptions().then((saved) => {
      opts = clean(saved);
    });

    const save = () => granite.caret.setOptions(opts);

    granite.commands.add({
      id: "reset",
      name: "Reset the cursor to the default",
      run: async () => {
        opts = clean(null);
        await save();
        granite.notice("Cursor reset");
      },
    });

    void granite.ui.headerButton({
      title: "Cursor",
      icon: ICON,
      open: (el, panel) => {
        const doc = el.ownerDocument;
        const make = (tag, props, ...kids) => {
          const n = Object.assign(doc.createElement(tag), props);
          n.append(...kids.filter((k) => k !== ""));
          return n;
        };
        const draw = () => {
          const scrolled = doc.scrollingElement ? doc.scrollingElement.scrollTop : 0; // redrawing must not throw the window back to the top
          el.replaceChildren();
          if (!doc.getElementById("fx-css")) doc.head.append(Object.assign(doc.createElement("style"), { id: "fx-css", textContent: PANEL_CSS }));
          const set = (patch) => {
            opts = clean({ ...opts, ...patch });
            void save();
            draw();
          };
          const seg = (key, value, text) => {
            const b = make("button", { textContent: text, className: opts[key] === value ? "on" : "" });
            b.onclick = () => set({ [key]: value });
            return b;
          };
          const check = (key, title, hint) => {
            const box = make("input", { type: "checkbox", checked: !!opts[key] });
            box.onchange = () => set({ [key]: box.checked });
            return make("label", {}, box, make("span", {}, title, hint ? make("small", { textContent: hint }) : ""));
          };
          const slider = (key, title, min, max, step) => {
            const r = make("input", { type: "range", min, max, step, value: opts[key] });
            r.onchange = () => set({ [key]: Number(r.value) });
            return make("label", { className: "slider" }, make("span", { textContent: title }), r);
          };
          const colour = make("input", { type: "color", value: opts.color || "#e8871e" });
          colour.onchange = () => set({ color: colour.value });
          const theme = make("button", { textContent: "Theme colour", className: opts.color === "" ? "on" : "" });
          theme.onclick = () => set({ color: "" });
          const blink = make("select", {}, ...[["blink", "Blink"], ["smooth", "Fade"], ["solid", "Steady"]].map(([v, t]) => make("option", { value: v, textContent: t, selected: opts.blink === v })));
          blink.onchange = () => set({ blink: blink.value });
          const done = make("button", { textContent: "Done", className: "done" });
          done.onclick = () => panel.close();

          el.append(
            make("h2", { textContent: "Cursor" }),
            make("div", { className: "row" }, ...PRESETS.map(([name, p]) => Object.assign(make("button", { textContent: name }), { onclick: () => set(p) }))),
            make("h3", { textContent: "Shape" }),
            make("div", { className: "row" }, seg("shape", "line", "Line"), seg("shape", "box", "Block"), seg("shape", "underline", "Underline")),
            opts.shape === "box" ? check("hollow", "Outline only") : "",
            make("h3", { textContent: "Look" }),
            make("div", { className: "row" }, colour, theme, blink),
            slider("thickness", "Thickness", 1, 8, 1),
            slider("opacity", "Strength", 0.2, 1, 0.05),
            slider("speed", "Blink speed", 0.4, 3, 0.1),
            check("glide", "Glide", "Slide to the next spot instead of jumping"),
            make("h3", { textContent: "Effects" }),
            check("trail", "Pixel trail", "A puff of pixels where the cursor has been"),
            check("dust", "Dust", "Motes rise from the cursor as you type"),
            check("pop", "Pop", "Letters float up as you type; deleting bursts"),
            check("spot", "Torch", "Dim everything but a pool of light around the cursor"),
            done,
          );
          if (doc.scrollingElement) doc.scrollingElement.scrollTop = scrolled;
          panel.resize(doc.documentElement.scrollHeight); // as tall as its content (the app keeps it inside the screen)
        };
        draw();
      },
    });
  }

  if (typeof __cursorFxTest !== "undefined") Object.assign(__cursorFxTest, { clean, DEFAULTS }); // for the tests

  void granite.caret.overlay(drawOverlay);
  if (!granite.caret.inOverlay) main();
})();
