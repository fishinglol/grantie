// Excel: a spreadsheet that lives inside a note, like Excel / Google Sheets.
//
// A sheet is a fenced block in the note:   ```sheet  { …json… }  ```
// Granite draws every such block as a live grid in place (the plugin runs in a sandboxed frame per block);
// while the cursor is inside the block it shows as plain text. Typing in the grid rewrites the JSON, so the
// note stays an ordinary Markdown file that syncs like any other.
//
// This file has two halves: the formula ENGINE (pure functions, tested from Node) and the GRID (the UI).

"use strict";

// ════════════════════════════════════════════════════════════════════════════
// ENGINE
// ════════════════════════════════════════════════════════════════════════════

const MAX_ROWS = 1000;
const MAX_COLS = 78;

class XErr {
  constructor(code) {
    this.code = code;
  }
}

function colName(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
function colIndex(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
const cellKey = (c, r) => colName(c) + (r + 1);
function parseCellKey(k) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(k.toUpperCase());
  return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null;
}

// ── Values ──────────────────────────────────────────────────────────────────

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

function dateToSerial(d) {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000) + 25569;
}
function serialToDate(n) {
  return new Date(Math.round((n - 25569) * 86400000));
}
function isoFromSerial(n) {
  return serialToDate(n).toISOString().slice(0, 10);
}

/** What typing `raw` into a cell means: a number, a date (as a serial number), TRUE/FALSE or text. */
function literal(raw) {
  const s = raw.trim();
  if (NUM_RE.test(s)) return Number(s);
  if (/^[+-]?(\d+\.?\d*|\.\d+)%$/.test(s)) return Number(s.slice(0, -1)) / 100;
  if (/^[+-]?[$€£฿¥]\s?\d[\d,]*(\.\d+)?$/.test(s)) return Number(s.replace(/[^\d.+-]/g, ""));
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  const d = ISO_DATE.exec(s);
  if (d) {
    const t = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
    if (!Number.isNaN(t)) return Math.floor(t / 86400000) + 25569;
  }
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  return raw;
}

function general(n) {
  if (!Number.isFinite(n)) return "#NUM!";
  return String(Number(n.toPrecision(12)));
}
function grouped(n, dp) {
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function toNum(v) {
  if (v instanceof XErr) throw v;
  if (Array.isArray(v)) return toNum(v[0]?.[0] ?? null);
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const l = literal(v);
  if (typeof l === "number") return l;
  throw new XErr("#VALUE!");
}
function toStr(v) {
  if (v instanceof XErr) throw v;
  if (Array.isArray(v)) return toStr(v[0]?.[0] ?? null);
  if (v === null) return "";
  if (typeof v === "number") return general(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v;
}
function toBool(v) {
  if (v instanceof XErr) throw v;
  if (Array.isArray(v)) return toBool(v[0]?.[0] ?? null);
  if (typeof v === "string") {
    if (/^true$/i.test(v)) return true;
    if (/^false$/i.test(v)) return false;
    throw new XErr("#VALUE!");
  }
  return Boolean(v);
}
const scalar = (v) => (Array.isArray(v) ? (v[0]?.[0] ?? null) : v);

const rank = (v) => (v === null ? 0 : typeof v === "number" ? 1 : typeof v === "string" ? 2 : 3);
/** Excel's ordering: numbers < text < booleans; text ignores case. */
function compare(a, b) {
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === "string") {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
const same = (a, b) => compare(a, b) === 0;

/** COUNTIF-style criteria: 5, ">5", "<>x", "=abc", "ab*" */
function criterion(c) {
  if (typeof c === "number") return (v) => typeof v === "number" && v === c;
  if (typeof c === "boolean") return (v) => v === c;
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(toStr(c));
  const op = m[1] || "=";
  const rhs = m[2];
  const lit = literal(rhs);
  if (typeof lit === "number" && op !== "=" && op !== "<>") {
    return (v) => {
      if (typeof v !== "number") return false;
      return op === "<" ? v < lit : op === ">" ? v > lit : op === "<=" ? v <= lit : v >= lit;
    };
  }
  const wild = new RegExp("^" + rhs.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
  const eq = (v) => {
    if (typeof lit === "number") return typeof v === "number" && v === lit;
    if (rhs === "") return v === null || v === "";
    return v !== null && wild.test(toStr(v));
  };
  return op === "<>" ? (v) => !eq(v) : eq;
}

// ── Formula text: tokens, references, rewriting ────────────────────────────

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    let m;
    if (ch === '"') {
      let j = i + 1;
      let s = "";
      for (;;) {
        if (j >= src.length) throw new XErr("#ERROR!");
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ t: "str", v: s, s: i, e: j + 1 });
      i = j + 1;
    } else if ((m = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(])/.exec(rest))) {
      out.push({ t: "range", c1: colIndex(m[2]), r1: 0, c2: colIndex(m[4]), r2: Infinity, ac1: !!m[1], ac2: !!m[3], ar1: false, ar2: false, whole: true, s: i, e: i + m[0].length });
      i += m[0].length;
    } else if ((m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(])/.exec(rest))) {
      const tok = { t: m[6] ? "range" : "ref", c1: colIndex(m[2]), r1: Number(m[4]) - 1, ac1: !!m[1], ar1: !!m[3], s: i, e: i + m[0].length };
      if (m[6]) Object.assign(tok, { c2: colIndex(m[6]), r2: Number(m[8]) - 1, ac2: !!m[5], ar2: !!m[7] });
      out.push(tok);
      i += m[0].length;
    } else if ((m = /^(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) {
      out.push({ t: "num", v: Number(m[0]), s: i, e: i + m[0].length });
      i += m[0].length;
    } else if ((m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest))) {
      out.push({ t: "name", v: m[0].toUpperCase(), s: i, e: i + m[0].length });
      i += m[0].length;
    } else if ((m = /^(<=|>=|<>|[-+*/^&=<>%(),;])/.exec(rest))) {
      out.push({ t: "op", v: m[0] === ";" ? "," : m[0], s: i, e: i + m[0].length });
      i += m[0].length;
    } else {
      throw new XErr("#ERROR!");
    }
  }
  return out;
}

/** "$B$2" style text for a reference's corner. */
const cornerText = (c, r, ac, ar) => (ac ? "$" : "") + colName(c) + (ar ? "$" : "") + (r + 1);

/**
 * Rewrite every reference in a formula. `fn(ref)` gets `{ c1, r1, c2, r2, ac1, ar1, ac2, ar2, range, whole }` and
 * returns the new ref (same shape) or null for #REF!.
 */
function mapRefs(formula, fn) {
  if (typeof formula !== "string" || formula[0] !== "=") return formula;
  let toks;
  try {
    toks = tokenize(formula.slice(1));
  } catch {
    return formula;
  }
  let out = "=";
  let at = 0;
  const body = formula.slice(1);
  for (const t of toks) {
    if (t.t !== "ref" && t.t !== "range") continue;
    out += body.slice(at, t.s);
    at = t.e;
    const n = fn({ ...t, range: t.t === "range" });
    if (!n || n.c1 < 0 || n.c2 < 0 || n.c1 >= MAX_COLS + 200 || (!n.whole && (n.r1 < 0 || n.r2 < 0))) out += "#REF!";
    else if (n.whole) out += cornerText(n.c1, 0, n.ac1, false).replace(/\d+$/, "") + ":" + cornerText(n.c2, 0, n.ac2, false).replace(/\d+$/, "");
    else if (t.t === "ref") out += cornerText(n.c1, n.r1, n.ac1, n.ar1);
    else out += cornerText(n.c1, n.r1, n.ac1, n.ar1) + ":" + cornerText(n.c2, n.r2, n.ac2, n.ar2);
  }
  return out + body.slice(at);
}

/** Formula as it would be if moved by (dr, dc): relative references follow, `$` ones stay (copy, paste, fill). */
function shiftFormula(formula, dr, dc) {
  return mapRefs(formula, (t) => ({
    ...t,
    c1: t.ac1 ? t.c1 : t.c1 + dc,
    r1: t.ar1 || t.whole ? t.r1 : t.r1 + dr,
    c2: t.range ? (t.ac2 ? t.c2 : t.c2 + dc) : t.c1,
    r2: t.range ? (t.ar2 || t.whole ? t.r2 : t.r2 + dr) : t.r1,
  }));
}

/** Formula after `count` rows (axis "r") or columns ("c") were inserted at `at` (count > 0) or deleted (count < 0). */
function adjustForLines(formula, axis, at, count) {
  const lo = axis === "c" ? "c1" : "r1";
  const hi = axis === "c" ? "c2" : "r2";
  return mapRefs(formula, (t) => {
    if (t.whole && axis === "r") return t;
    const a = t[lo];
    const b = t.range ? t[hi] : t[lo];
    let na;
    let nb;
    if (count > 0) {
      na = a >= at ? a + count : a;
      nb = b >= at ? b + count : b;
    } else {
      const end = at - count; // first line after the deleted span
      const del = (x) => x >= at && x < end;
      if (!t.range && del(a)) return null;
      na = del(a) ? at : a >= end ? a + count : a;
      nb = del(b) ? at - 1 : b >= end ? b + count : b;
      if (nb < na) return null;
    }
    return { ...t, [lo]: na, ...(t.range ? { [hi]: nb } : { [axis === "c" ? "c2" : "r2"]: nb }) };
  });
}

// ── Parser ──────────────────────────────────────────────────────────────────

const parsed = new Map();
function parseFormula(src) {
  let ast = parsed.get(src);
  if (ast) return ast;
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...vs) => peek() && peek().t === "op" && vs.includes(peek().v);
  const cmp = () => {
    let a = cat();
    while (isOp("=", "<>", "<", ">", "<=", ">=")) a = { t: "bin", op: toks[p++].v, a, b: cat() };
    return a;
  };
  const cat = () => {
    let a = add();
    while (isOp("&")) a = { t: "bin", op: toks[p++].v, a, b: add() };
    return a;
  };
  const add = () => {
    let a = mul();
    while (isOp("+", "-")) a = { t: "bin", op: toks[p++].v, a, b: mul() };
    return a;
  };
  const mul = () => {
    let a = pow();
    while (isOp("*", "/")) a = { t: "bin", op: toks[p++].v, a, b: pow() };
    return a;
  };
  const pow = () => {
    let a = unary();
    while (isOp("^")) a = { t: "bin", op: toks[p++].v, a, b: unary() };
    return a;
  };
  const unary = () => {
    if (isOp("-", "+")) return { t: "un", op: toks[p++].v, a: unary() };
    let a = primary();
    while (isOp("%")) {
      p++;
      a = { t: "pct", a };
    }
    return a;
  };
  const primary = () => {
    const t = toks[p++];
    if (!t) throw new XErr("#ERROR!");
    if (t.t === "num") return { t: "lit", v: t.v };
    if (t.t === "str") return { t: "lit", v: t.v };
    if (t.t === "ref") return { t: "ref", c: t.c1, r: t.r1 };
    if (t.t === "range") return { t: "range", c1: Math.min(t.c1, t.c2), r1: Math.min(t.r1, t.r2), c2: Math.max(t.c1, t.c2), r2: Math.max(t.r1, t.r2), whole: !!t.whole };
    if (t.t === "name") {
      if (isOp("(")) {
        p++;
        const args = [];
        if (isOp(")")) p++;
        else {
          for (;;) {
            args.push(isOp(",", ")") ? { t: "empty" } : cmp());
            if (isOp(",")) {
              p++;
              continue;
            }
            if (isOp(")")) {
              p++;
              break;
            }
            throw new XErr("#ERROR!");
          }
        }
        return { t: "call", name: t.v, args };
      }
      if (t.v === "TRUE") return { t: "lit", v: true };
      if (t.v === "FALSE") return { t: "lit", v: false };
      return { t: "call", name: "\0name", args: [], label: t.v };
    }
    if (t.t === "op" && t.v === "(") {
      const a = cmp();
      if (!isOp(")")) throw new XErr("#ERROR!");
      p++;
      return a;
    }
    throw new XErr("#ERROR!");
  };
  ast = cmp();
  if (p < toks.length) throw new XErr("#ERROR!");
  parsed.set(src, ast);
  return ast;
}

// ── Functions ───────────────────────────────────────────────────────────────

/** Numbers from arguments: ranges contribute their numeric cells, single values are converted. */
function numbersOf(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const row of a)
        for (const v of row) {
          if (v instanceof XErr) throw v;
          if (typeof v === "number") out.push(v);
        }
    } else if (a !== null) out.push(toNum(a));
  }
  return out;
}
const cells2d = (a) => (Array.isArray(a) ? a : [[a]]);
const flat = (a) => cells2d(a).flat();

function roundTo(n, d, mode) {
  const f = 10 ** d;
  const x = n * f;
  const r = mode === "up" ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-12) : mode === "down" ? Math.trunc(x) : Math.sign(x) * Math.round(Math.abs(x) + 1e-12);
  return r / f;
}

function pad(n, w) {
  return String(n).padStart(w, "0");
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** TEXT(value, "0.00" | "#,##0" | "0%" | "yyyy-mm-dd" …) */
function textFormat(v, fmt) {
  if (typeof v !== "number") return toStr(v);
  if (/[ymdh]/i.test(fmt) && !/^[#0,.%]+$/.test(fmt)) {
    const d = serialToDate(v);
    return fmt.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d|hh|ss/gi, (t) => {
      switch (t.toLowerCase()) {
        case "yyyy": return pad(d.getUTCFullYear(), 4);
        case "yy": return pad(d.getUTCFullYear() % 100, 2);
        case "mmmm": return MONTHS[d.getUTCMonth()];
        case "mmm": return MONTHS[d.getUTCMonth()].slice(0, 3);
        case "mm": return pad(d.getUTCMonth() + 1, 2);
        case "m": return String(d.getUTCMonth() + 1);
        case "dd": return pad(d.getUTCDate(), 2);
        case "d": return String(d.getUTCDate());
        case "hh": return pad(d.getUTCHours(), 2);
        default: return pad(d.getUTCSeconds(), 2);
      }
    });
  }
  const pct = fmt.includes("%");
  const dp = (/\.([0#]+)/.exec(fmt) || [, ""])[1].length;
  const x = pct ? v * 100 : v;
  const body = fmt.includes(",") ? grouped(x, dp) : x.toFixed(dp);
  return body + (pct ? "%" : "");
}

/** Functions that need their arguments unevaluated (so IF only runs the branch it takes). */
const LAZY = {
  IF: (a, run) => (toBool(run(a[0])) ? run(a[1] ?? { t: "lit", v: true }) : a[2] ? run(a[2]) : false),
  IFERROR: (a, run) => {
    try {
      const v = scalar(run(a[0]));
      return v instanceof XErr ? run(a[1]) : v;
    } catch (e) {
      if (e instanceof XErr) return run(a[1]);
      throw e;
    }
  },
  IFNA: (a, run) => {
    try {
      const v = scalar(run(a[0]));
      return v instanceof XErr && v.code === "#N/A" ? run(a[1]) : v;
    } catch (e) {
      if (e instanceof XErr && e.code === "#N/A") return run(a[1]);
      throw e;
    }
  },
  IFS: (a, run) => {
    for (let i = 0; i + 1 < a.length; i += 2) if (toBool(run(a[i]))) return run(a[i + 1]);
    throw new XErr("#N/A");
  },
  CHOOSE: (a, run) => {
    const i = Math.trunc(toNum(run(a[0])));
    if (i < 1 || i >= a.length) throw new XErr("#VALUE!");
    return run(a[i]);
  },
  SWITCH: (a, run) => {
    const v = scalar(run(a[0]));
    for (let i = 1; i + 1 < a.length; i += 2) if (same(v, scalar(run(a[i])))) return run(a[i + 1]);
    if (a.length % 2 === 0) return run(a[a.length - 1]);
    throw new XErr("#N/A");
  },
};

const FN = {
  // maths
  SUM: (a) => numbersOf(a).reduce((x, y) => x + y, 0),
  AVERAGE: (a) => {
    const n = numbersOf(a);
    if (!n.length) throw new XErr("#DIV/0!");
    return n.reduce((x, y) => x + y, 0) / n.length;
  },
  MIN: (a) => Math.min(...numbersOf(a), ...(numbersOf(a).length ? [] : [0])),
  MAX: (a) => Math.max(...numbersOf(a), ...(numbersOf(a).length ? [] : [0])),
  COUNT: (a) => a.reduce((n, x) => n + (Array.isArray(x) ? flat(x).filter((v) => typeof v === "number").length : typeof scalar(x) === "number" || (typeof x === "string" && typeof literal(x) === "number") ? 1 : 0), 0),
  COUNTA: (a) => a.reduce((n, x) => n + flat(x).filter((v) => v !== null && v !== "").length, 0),
  COUNTBLANK: (a) => a.reduce((n, x) => n + flat(x).filter((v) => v === null || v === "").length, 0),
  PRODUCT: (a) => numbersOf(a).reduce((x, y) => x * y, 1),
  MEDIAN: (a) => {
    const n = numbersOf(a).sort((x, y) => x - y);
    if (!n.length) throw new XErr("#NUM!");
    const m = n.length >> 1;
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
  },
  LARGE: (a) => {
    const n = numbersOf([a[0]]).sort((x, y) => y - x);
    const k = toNum(a[1]);
    if (k < 1 || k > n.length) throw new XErr("#NUM!");
    return n[k - 1];
  },
  SMALL: (a) => {
    const n = numbersOf([a[0]]).sort((x, y) => x - y);
    const k = toNum(a[1]);
    if (k < 1 || k > n.length) throw new XErr("#NUM!");
    return n[k - 1];
  },
  STDEV: (a) => {
    const n = numbersOf(a);
    if (n.length < 2) throw new XErr("#DIV/0!");
    const mean = n.reduce((x, y) => x + y, 0) / n.length;
    return Math.sqrt(n.reduce((s, x) => s + (x - mean) ** 2, 0) / (n.length - 1));
  },
  SUMPRODUCT: (a) => {
    const lists = a.map((x) => flat(x).map((v) => (typeof v === "number" ? v : 0)));
    if (lists.some((l) => l.length !== lists[0].length)) throw new XErr("#VALUE!");
    return lists[0].reduce((s, _, i) => s + lists.reduce((p, l) => p * l[i], 1), 0);
  },
  ROUND: (a) => roundTo(toNum(a[0]), a[1] === undefined ? 0 : toNum(a[1]), "half"),
  ROUNDUP: (a) => roundTo(toNum(a[0]), a[1] === undefined ? 0 : toNum(a[1]), "up"),
  ROUNDDOWN: (a) => roundTo(toNum(a[0]), a[1] === undefined ? 0 : toNum(a[1]), "down"),
  TRUNC: (a) => roundTo(toNum(a[0]), a[1] === undefined ? 0 : toNum(a[1]), "down"),
  ABS: (a) => Math.abs(toNum(a[0])),
  SIGN: (a) => Math.sign(toNum(a[0])),
  SQRT: (a) => {
    const n = toNum(a[0]);
    if (n < 0) throw new XErr("#NUM!");
    return Math.sqrt(n);
  },
  POWER: (a) => toNum(a[0]) ** toNum(a[1]),
  EXP: (a) => Math.exp(toNum(a[0])),
  LN: (a) => {
    const n = toNum(a[0]);
    if (n <= 0) throw new XErr("#NUM!");
    return Math.log(n);
  },
  LOG: (a) => Math.log(toNum(a[0])) / Math.log(a[1] === undefined ? 10 : toNum(a[1])),
  LOG10: (a) => Math.log10(toNum(a[0])),
  MOD: (a) => {
    const d = toNum(a[1]);
    if (d === 0) throw new XErr("#DIV/0!");
    const n = toNum(a[0]);
    return n - d * Math.floor(n / d);
  },
  INT: (a) => Math.floor(toNum(a[0])),
  CEILING: (a) => {
    const s = a[1] === undefined ? 1 : toNum(a[1]);
    return s === 0 ? 0 : Math.ceil(toNum(a[0]) / s) * s;
  },
  FLOOR: (a) => {
    const s = a[1] === undefined ? 1 : toNum(a[1]);
    return s === 0 ? 0 : Math.floor(toNum(a[0]) / s) * s;
  },
  PI: () => Math.PI,
  RAND: () => Math.random(),
  RANDBETWEEN: (a) => {
    const lo = Math.ceil(toNum(a[0]));
    return lo + Math.floor(Math.random() * (Math.floor(toNum(a[1])) - lo + 1));
  },
  // logic
  AND: (a) => flat(a.length === 1 ? a[0] : a.map(scalar)).every((v) => toBool(v)),
  OR: (a) => flat(a.length === 1 ? a[0] : a.map(scalar)).some((v) => toBool(v)),
  XOR: (a) => flat(a).filter((v) => toBool(v)).length % 2 === 1,
  NOT: (a) => !toBool(a[0]),
  TRUE: () => true,
  FALSE: () => false,
  ISBLANK: (a) => scalar(a[0]) === null,
  ISNUMBER: (a) => typeof scalar(a[0]) === "number",
  ISTEXT: (a) => typeof scalar(a[0]) === "string",
  ISERROR: (a) => scalar(a[0]) instanceof XErr,
  ISNA: (a) => scalar(a[0]) instanceof XErr && scalar(a[0]).code === "#N/A",
  NA: () => {
    throw new XErr("#N/A");
  },
  // text
  LEN: (a) => toStr(a[0]).length,
  UPPER: (a) => toStr(a[0]).toUpperCase(),
  LOWER: (a) => toStr(a[0]).toLowerCase(),
  PROPER: (a) => toStr(a[0]).toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_, p, c) => p + c.toUpperCase()),
  TRIM: (a) => toStr(a[0]).trim().replace(/\s+/g, " "),
  LEFT: (a) => toStr(a[0]).slice(0, a[1] === undefined ? 1 : toNum(a[1])),
  RIGHT: (a) => {
    const s = toStr(a[0]);
    const n = a[1] === undefined ? 1 : toNum(a[1]);
    return n <= 0 ? "" : s.slice(-n);
  },
  MID: (a) => toStr(a[0]).substr(toNum(a[1]) - 1, toNum(a[2])),
  CONCAT: (a) => a.map((x) => flat(x).map(toStr).join("")).join(""),
  CONCATENATE: (a) => a.map(toStr).join(""),
  TEXTJOIN: (a) => {
    const sep = toStr(a[0]);
    const skip = toBool(a[1]);
    return a
      .slice(2)
      .flatMap(flat)
      .filter((v) => !(skip && (v === null || v === "")))
      .map(toStr)
      .join(sep);
  },
  SUBSTITUTE: (a) => toStr(a[0]).split(toStr(a[1])).join(toStr(a[2])),
  REPLACE: (a) => {
    const s = toStr(a[0]);
    const at = toNum(a[1]) - 1;
    return s.slice(0, at) + toStr(a[3]) + s.slice(at + toNum(a[2]));
  },
  FIND: (a) => {
    const i = toStr(a[1]).indexOf(toStr(a[0]), a[2] === undefined ? 0 : toNum(a[2]) - 1);
    if (i < 0) throw new XErr("#VALUE!");
    return i + 1;
  },
  SEARCH: (a) => {
    const i = toStr(a[1]).toLowerCase().indexOf(toStr(a[0]).toLowerCase(), a[2] === undefined ? 0 : toNum(a[2]) - 1);
    if (i < 0) throw new XErr("#VALUE!");
    return i + 1;
  },
  REPT: (a) => toStr(a[0]).repeat(Math.max(0, toNum(a[1]))),
  EXACT: (a) => toStr(a[0]) === toStr(a[1]),
  VALUE: (a) => {
    const l = literal(toStr(a[0]));
    if (typeof l !== "number") throw new XErr("#VALUE!");
    return l;
  },
  TEXT: (a) => textFormat(scalar(a[0]), toStr(a[1])),
  // conditional aggregates
  COUNTIF: (a) => {
    const t = criterion(scalar(a[1]));
    return flat(a[0]).filter(t).length;
  },
  SUMIF: (a) => {
    const t = criterion(scalar(a[1]));
    const test = flat(a[0]);
    const sum = a[2] === undefined ? test : flat(a[2]);
    return test.reduce((s, v, i) => s + (t(v) && typeof sum[i] === "number" ? sum[i] : 0), 0);
  },
  AVERAGEIF: (a) => {
    const t = criterion(scalar(a[1]));
    const test = flat(a[0]);
    const avg = a[2] === undefined ? test : flat(a[2]);
    const hit = test.map((v, i) => (t(v) && typeof avg[i] === "number" ? avg[i] : null)).filter((v) => v !== null);
    if (!hit.length) throw new XErr("#DIV/0!");
    return hit.reduce((x, y) => x + y, 0) / hit.length;
  },
  COUNTIFS: (a) => {
    const lists = [];
    for (let i = 0; i + 1 < a.length; i += 2) lists.push([flat(a[i]), criterion(scalar(a[i + 1]))]);
    return lists[0][0].filter((_, k) => lists.every(([l, t]) => t(l[k]))).length;
  },
  SUMIFS: (a) => {
    const sum = flat(a[0]);
    const lists = [];
    for (let i = 1; i + 1 < a.length; i += 2) lists.push([flat(a[i]), criterion(scalar(a[i + 1]))]);
    return sum.reduce((s, v, k) => s + (lists.every(([l, t]) => t(l[k])) && typeof v === "number" ? v : 0), 0);
  },
  // lookup
  VLOOKUP: (a) => {
    const key = scalar(a[0]);
    const t = cells2d(a[1]);
    const col = toNum(a[2]) - 1;
    if (col < 0 || col >= (t[0]?.length ?? 0)) throw new XErr("#REF!");
    const exact = a[3] !== undefined && !toBool(a[3]);
    let hit = -1;
    for (let i = 0; i < t.length; i++) {
      if (exact ? same(t[i][0], key) : compare(t[i][0], key) <= 0) hit = i;
      if (exact && hit >= 0) break;
    }
    if (hit < 0) throw new XErr("#N/A");
    return t[hit][col];
  },
  HLOOKUP: (a) => {
    const key = scalar(a[0]);
    const t = cells2d(a[1]);
    const row = toNum(a[2]) - 1;
    if (row < 0 || row >= t.length) throw new XErr("#REF!");
    const exact = a[3] !== undefined && !toBool(a[3]);
    let hit = -1;
    for (let i = 0; i < t[0].length; i++) {
      if (exact ? same(t[0][i], key) : compare(t[0][i], key) <= 0) hit = i;
      if (exact && hit >= 0) break;
    }
    if (hit < 0) throw new XErr("#N/A");
    return t[row][hit];
  },
  XLOOKUP: (a) => {
    const key = scalar(a[0]);
    const look = flat(a[1]);
    const ret = flat(a[2]);
    const i = look.findIndex((v) => same(v, key));
    if (i < 0) {
      if (a[3] !== undefined) return scalar(a[3]);
      throw new XErr("#N/A");
    }
    return ret[i] ?? null;
  },
  MATCH: (a) => {
    const key = scalar(a[0]);
    const list = flat(a[1]);
    const type = a[2] === undefined ? 1 : toNum(a[2]);
    let hit = -1;
    if (type === 0) hit = list.findIndex((v) => same(v, key));
    else
      for (let i = 0; i < list.length; i++) {
        const c = compare(list[i], key);
        if (type > 0 ? c <= 0 : c >= 0) hit = i;
      }
    if (hit < 0) throw new XErr("#N/A");
    return hit + 1;
  },
  INDEX: (a) => {
    const t = cells2d(a[0]);
    const r = a[1] === undefined ? 1 : toNum(a[1]);
    const c = a[2] === undefined ? (t.length === 1 ? r : 1) : toNum(a[2]);
    const row = t.length === 1 && a[2] === undefined ? 1 : r;
    if (row < 1 || row > t.length || c < 1 || c > t[0].length) throw new XErr("#REF!");
    return t[row - 1][c - 1];
  },
  ROWS: (a) => cells2d(a[0]).length,
  COLUMNS: (a) => cells2d(a[0])[0].length,
  // dates
  TODAY: () => dateToSerial(new Date(Date.now() - new Date().getTimezoneOffset() * 60000)),
  NOW: () => (Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000 + 25569,
  DATE: (a) => Math.floor(Date.UTC(toNum(a[0]), toNum(a[1]) - 1, toNum(a[2])) / 86400000) + 25569,
  YEAR: (a) => serialToDate(toNum(a[0])).getUTCFullYear(),
  MONTH: (a) => serialToDate(toNum(a[0])).getUTCMonth() + 1,
  DAY: (a) => serialToDate(toNum(a[0])).getUTCDate(),
  WEEKDAY: (a) => {
    const d = serialToDate(toNum(a[0])).getUTCDay();
    return a[1] !== undefined && toNum(a[1]) === 2 ? (d === 0 ? 7 : d) : d + 1;
  },
  DAYS: (a) => Math.trunc(toNum(a[0])) - Math.trunc(toNum(a[1])),
  EDATE: (a) => {
    const d = serialToDate(toNum(a[0]));
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + toNum(a[1]), d.getUTCDate()) / 86400000) + 25569;
  },
  DATEDIF: (a) => {
    const x = serialToDate(toNum(a[0]));
    const y = serialToDate(toNum(a[1]));
    if (y < x) throw new XErr("#NUM!");
    const unit = toStr(a[2]).toUpperCase();
    const months = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth() - (y.getUTCDate() < x.getUTCDate() ? 1 : 0);
    if (unit === "D") return Math.round((y - x) / 86400000);
    if (unit === "M") return months;
    if (unit === "Y") return Math.floor(months / 12);
    throw new XErr("#NUM!");
  },
};

/** A sheet's values: `cell(c, r)` evaluates lazily and caches, so build a new one after every edit. */
function makeEvaluator(model) {
  const cache = new Map();
  const active = new Set();

  function cell(c, r) {
    const k = cellKey(c, r);
    if (cache.has(k)) return cache.get(k);
    if (active.has(k)) throw new XErr("#CIRCULAR!");
    active.add(k);
    let v;
    try {
      const raw = model.cells[k]?.v;
      if (raw === undefined || raw === null || raw === "") v = null;
      else if (raw[0] === "=") v = scalar(run(parseFormula(raw.slice(1))));
      else v = literal(raw);
    } catch (e) {
      if (!(e instanceof XErr)) throw e;
      v = e;
    } finally {
      active.delete(k);
    }
    cache.set(k, v);
    return v;
  }

  function run(n) {
    switch (n.t) {
      case "lit":
        return n.v;
      case "empty":
        return null;
      case "ref":
        return cell(n.c, n.r);
      case "range": {
        const r2 = n.whole ? model.rows - 1 : n.r2;
        const out = [];
        for (let r = n.r1; r <= r2; r++) {
          const row = [];
          for (let c = n.c1; c <= n.c2; c++) row.push(cell(c, r));
          out.push(row);
        }
        return out;
      }
      case "un": {
        const v = toNum(run(n.a));
        return n.op === "-" ? -v : v;
      }
      case "pct":
        return toNum(run(n.a)) / 100;
      case "bin": {
        const a = scalar(run(n.a));
        const b = scalar(run(n.b));
        if (a instanceof XErr) throw a;
        if (b instanceof XErr) throw b;
        switch (n.op) {
          case "+": return toNum(a) + toNum(b);
          case "-": return toNum(a) - toNum(b);
          case "*": return toNum(a) * toNum(b);
          case "/": {
            const d = toNum(b);
            if (d === 0) throw new XErr("#DIV/0!");
            return toNum(a) / d;
          }
          case "^": return toNum(a) ** toNum(b);
          case "&": return toStr(a) + toStr(b);
          case "=": return compare(a, b) === 0;
          case "<>": return compare(a, b) !== 0;
          case "<": return compare(a, b) < 0;
          case ">": return compare(a, b) > 0;
          case "<=": return compare(a, b) <= 0;
          default: return compare(a, b) >= 0;
        }
      }
      case "call": {
        if (n.name === "\0name") throw new XErr("#NAME?");
        if (LAZY[n.name]) return LAZY[n.name](n.args, run);
        const fn = FN[n.name];
        if (!fn) throw new XErr("#NAME?");
        return fn(n.args.map(run));
      }
    }
    throw new XErr("#ERROR!");
  }

  /** Value of a formula typed outside any cell (a conditional-formatting rule); errors count as no value. */
  function formula(src) {
    try {
      return scalar(run(parseFormula(src.replace(/^=/, ""))));
    } catch (e) {
      if (e instanceof XErr) return null;
      throw e;
    }
  }

  return { cell, formula };
}

// ── Sheet data ──────────────────────────────────────────────────────────────

// ── Sheet-level formatting: merged cells, conditional formatting, alternating colours ──

/** Alternating-colour looks: a header fill, then two row tones. */
const ALT_PRESETS = [
  { h: "#4a86e8", a: "#ffffff", b: "#e8f0fe" },
  { h: "#57bb8a", a: "#ffffff", b: "#e6f4ea" },
  { h: "#e67c73", a: "#ffffff", b: "#fce8e6" },
  { h: "#f6b26b", a: "#ffffff", b: "#fdf0e0" },
  { h: "#674ea7", a: "#ffffff", b: "#ede7f6" },
  { h: "#434343", a: "#ffffff", b: "#efefef" },
];

const CF_KINDS = [
  ["notEmpty", "Is not empty"], ["empty", "Is empty"], ["contains", "Text contains"], ["notContains", "Text does not contain"],
  ["is", "Text is exactly"], ["gt", "Greater than"], ["ge", "Greater than or equal to"], ["lt", "Less than"],
  ["le", "Less than or equal to"], ["eq", "Is equal to"], ["ne", "Is not equal to"], ["between", "Is between"], ["formula", "Custom formula is"],
];

const inRect = (m, r, c) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2;
const mergeAt = (merges, r, c) => merges.find((m) => inRect(m, r, c)) || null;

/** Grow a rectangle until it contains every merged range it touches (selecting part of a merge selects all of it). */
function expandForMerges(rect, merges) {
  let s = { r1: rect.r1, r2: rect.r2, c1: rect.c1, c2: rect.c2 };
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of merges) {
      const touches = m.r1 <= s.r2 && m.r2 >= s.r1 && m.c1 <= s.c2 && m.c2 >= s.c1;
      if (touches && (m.r1 < s.r1 || m.r2 > s.r2 || m.c1 < s.c1 || m.c2 > s.c2)) {
        s = { r1: Math.min(s.r1, m.r1), r2: Math.max(s.r2, m.r2), c1: Math.min(s.c1, m.c1), c2: Math.max(s.c2, m.c2) };
        grew = true;
      }
    }
  }
  return s;
}

/** A rectangle (`r1 c1 r2 c2` plus any other fields) after `count` rows/columns were inserted (>0) or deleted (<0) at `at`; null if it vanished. */
function adjustRect(rect, axis, at, count) {
  const lo = axis === "c" ? "c1" : "r1";
  const hi = axis === "c" ? "c2" : "r2";
  let a = rect[lo];
  let b = rect[hi];
  if (count > 0) {
    if (a >= at) a += count;
    if (b >= at) b += count;
  } else {
    const end = at - count;
    const del = (x) => x >= at && x < end;
    if (del(a) && del(b)) return null;
    a = del(a) ? at : a >= end ? a + count : a;
    b = del(b) ? at - 1 : b >= end ? b + count : b;
    if (b < a) return null;
  }
  return { ...rect, [lo]: a, [hi]: b };
}

/** Does conditional-formatting `rule` match a cell holding `v` and showing `shown`? (`formula` is the result of a custom-formula rule.) */
function cfTest(rule, v, shown, formula) {
  const empty = v === null || v === "";
  const a = String(rule.v ?? "");
  const text = shown.toLowerCase();
  const x = literal(a);
  const y = literal(String(rule.v2 ?? ""));
  const num = typeof v === "number" && typeof x === "number";
  switch (rule.k) {
    case "empty": return empty;
    case "notEmpty": return !empty;
    case "contains": return a !== "" && text.includes(a.toLowerCase());
    case "notContains": return !text.includes(a.toLowerCase());
    case "is": return text === a.toLowerCase();
    case "gt": return num && v > x;
    case "ge": return num && v >= x;
    case "lt": return num && v < x;
    case "le": return num && v <= x;
    case "eq": return num ? v === x : text === a.toLowerCase();
    case "ne": return num ? v !== x : text !== a.toLowerCase();
    case "between": return typeof v === "number" && typeof x === "number" && typeof y === "number" && v >= Math.min(x, y) && v <= Math.max(x, y);
    case "formula": return formula === true;
    default: return false;
  }
}

const THEMES = ["light", "dark", "sepia", "green"];
const FONTS = ["serif", "mono"];

/**
 * Rows a table's filters hide: a table is a rectangle (header row first) whose `f` maps a column offset to the
 * values still allowed there. Pure, so it can be tested.
 */
function hiddenRows(model, ev) {
  const hid = new Set();
  for (const t of model.tables) {
    if (!t.f) continue;
    for (let r = t.r1 + 1; r <= t.r2; r++) {
      for (const [off, allowed] of Object.entries(t.f)) {
        const c = t.c1 + Number(off);
        if (!allowed.includes(display(ev.cell(c, r), model.cells[cellKey(c, r)]))) {
          hid.add(r);
          break;
        }
      }
    }
  }
  return hid;
}

function emptySheet() {
  return { cols: 8, rows: 12, h: 380, page: 0, w: {}, rh: {}, cells: {}, merges: [], cf: [], alt: [], tables: [], th: "", ff: "" };
}

function parseSheet(text) {
  const m = emptySheet();
  if (text.trim() === "") return m;
  const j = JSON.parse(text);
  m.cols = Math.min(MAX_COLS, Math.max(1, Number(j.cols) || m.cols));
  m.rows = Math.min(MAX_ROWS, Math.max(1, Number(j.rows) || m.rows));
  m.h = Number(j.h) || m.h;
  m.page = j.page ? 1 : 0; // the sheet is the whole page, not a box in the note
  m.w = j.w && typeof j.w === "object" ? j.w : {};
  m.rh = j.rh && typeof j.rh === "object" ? j.rh : {};
  m.cells = j.cells && typeof j.cells === "object" ? j.cells : {};
  const rects = (list) => (Array.isArray(list) ? list.filter((x) => x && [x.r1, x.c1, x.r2, x.c2].every(Number.isInteger)) : []);
  m.merges = rects(j.merges);
  m.cf = rects(j.cf);
  m.alt = rects(j.alt);
  m.tables = rects(j.tables);
  m.th = THEMES.includes(j.th) ? j.th : "";
  m.ff = FONTS.includes(j.ff) ? j.ff : "";
  return m;
}

/** One cell per line, so a change to one cell is a one-line change in the note (and in sync). */
function serializeSheet(m) {
  const keys = Object.keys(m.cells).sort((a, b) => {
    const x = parseCellKey(a);
    const y = parseCellKey(b);
    return x.r - y.r || x.c - y.c;
  });
  const head = `"cols":${m.cols},"rows":${m.rows},"h":${Math.round(m.h)}${m.page ? ',"page":1' : ""}${m.th ? `,"th":"${m.th}"` : ""}${m.ff ? `,"ff":"${m.ff}"` : ""}`;
  const sizes = (name, o) => (Object.keys(o).length ? `,\n"${name}":${JSON.stringify(o)}` : "");
  const lists = ["merges", "cf", "alt", "tables"].map((n) => (m[n]?.length ? `,\n"${n}":${JSON.stringify(m[n])}` : "")).join("");
  return `{${head}${sizes("w", m.w)}${sizes("rh", m.rh)}${lists},\n"cells":{\n${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(m.cells[k])}`).join(",\n")}\n}}`;
}

/** How a value shows in a cell. */
function display(v, cell) {
  if (v === null) return "";
  if (v instanceof XErr) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  const nf = cell?.nf;
  const dp = (d) => (cell?.dp === undefined ? d : cell.dp);
  if (nf === "text") return general(v);
  if (nf === "date" || (!nf && typeof cell?.v === "string" && /^=\s*(TODAY|NOW|DATE|EDATE)\s*\(/i.test(cell.v))) return isoFromSerial(v);
  if (nf === "pct") return (v * 100).toFixed(dp(2)) + "%";
  if (nf === "cur") return (v < 0 ? "-" : "") + "$" + grouped(Math.abs(v), dp(2));
  if (nf === "num") return grouped(v, dp(2));
  if (nf === "int") return grouped(v, dp(0));
  if (cell?.dp !== undefined) return v.toFixed(cell.dp);
  return general(v);
}

/** What a freshly typed value implies about its format (typing 50% or 2026-09-21 formats the cell like Sheets does). */
function inferFormat(text) {
  const s = text.trim();
  const pct = /^[+-]?\d*\.?(\d*)%$/.exec(s);
  if (pct && NUM_RE.test(s.slice(0, -1))) return { nf: "pct", dp: pct[1].length };
  if (ISO_DATE.test(s) && typeof literal(s) === "number") return { nf: "date" };
  if (/^[+-]?[$€£฿¥]/.test(s) && typeof literal(s) === "number") return { nf: "cur", dp: (/\.(\d+)$/.exec(s) || [, ""])[1].length };
  return null;
}

if (typeof globalThis.__excelTest === "object") {
  Object.assign(globalThis.__excelTest, {
    hiddenRows, cfTest, adjustRect, expandForMerges, mergeAt, ALT_PRESETS, makeEvaluator, parseSheet, serializeSheet, shiftFormula, adjustForLines, display, inferFormat, literal, XErr, colName, colIndex, cellKey, textFormat,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// GRID (the UI; runs in the block's frame)
// ════════════════════════════════════════════════════════════════════════════

const STYLE = `
:root { --x-bg: var(--bg, #fff); --x-panel: var(--panel, #f1f3f4); --x-text: var(--text, #202124); --x-dim: var(--text-dim, #5f6368);
  --x-line: var(--panel-hover, #dadce0); --x-acc: var(--accent, #1a73e8); --x-grid: color-mix(in srgb, var(--x-text) 14%, transparent); }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; overflow: hidden; }
body { font: 13px/1.3 Arial, "Helvetica Neue", sans-serif; color: var(--x-text); }
#app { position: relative; height: 100%; display: flex; flex-direction: column; background: var(--x-bg); border: 1px solid var(--x-line); border-radius: 8px; overflow: hidden; }
#app { --x-grid: color-mix(in srgb, var(--x-text) 14%, transparent); color: var(--x-text); }
#app.th-light { --x-bg: #fff; --x-panel: #f1f3f4; --x-text: #202124; --x-dim: #5f6368; --x-line: #dadce0; --x-acc: #1a73e8; }
#app.th-dark { --x-bg: #1b1f2a; --x-panel: #2b3040; --x-text: #e6e9f0; --x-dim: #8b93a7; --x-line: #3a4055; --x-acc: #e8935f; }
#app.th-sepia { --x-bg: #f6efe0; --x-panel: #ebe1cb; --x-text: #3b2f20; --x-dim: #7a6a52; --x-line: #d6c8a8; --x-acc: #a5651b; }
#app.th-green { --x-bg: #f3f8f3; --x-panel: #e0eee1; --x-text: #1e3a26; --x-dim: #5a7a62; --x-line: #bcd5c0; --x-acc: #2e7d32; }
#app.ff-serif .c, #app.ff-serif #ed { font-family: Georgia, "Times New Roman", serif; }
#app.ff-mono .c, #app.ff-mono #ed { font-family: "SF Mono", Menlo, Consolas, monospace; }
#app.page { border: 0; border-radius: 0; }
.h { overflow: hidden; }
.c.rot { overflow: visible; }
.c .arr.tbl { cursor: pointer; padding: 2px 3px; }
.c .arr.tbl.on { color: var(--x-acc); }
.tmenu { min-width: 190px; max-height: 300px; overflow: auto; padding: 4px; }
.tmenu div { padding: 6px 10px; border-radius: 4px; cursor: pointer; }
.tmenu div:hover { background: var(--x-panel); }
.tmenu hr { border: 0; border-top: 1px solid var(--x-line); margin: 4px 0; }
.tmenu label { display: flex; gap: 8px; align-items: center; padding: 4px 10px; }
.altd { width: 250px; }
.altd label { display: flex; justify-content: space-between; align-items: center; margin: 0 0 8px; }
.altd input[type=color] { width: 48px; height: 26px; border: 1px solid var(--x-line); border-radius: 4px; padding: 0; background: none; }
@media (pointer: coarse) {
  #tb button { min-width: 36px; height: 36px; font-size: 15px; }
  #tb select { height: 36px; font-size: 15px; }
  #fb input { height: 32px; font-size: 15px; }
  .fmt .it, .fmt .sub div, .tmenu div, .menu div { padding: 10px 12px; }
  .pop { max-width: calc(100% - 8px); }
  .ddswatch { width: 28px; height: 28px; }
  .ddtrash { font-size: 18px; padding: 6px; }
  .grip { font-size: 20px; padding: 4px; }
  .ddrow input[type=text] { padding: 8px 6px; }
}
#tb { flex: none; display: flex; align-items: center; gap: 1px; padding: 3px 4px; background: var(--x-panel); border-bottom: 1px solid var(--x-line); overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
#tb::-webkit-scrollbar { display: none; }
#tb button { flex: none; min-width: 26px; height: 26px; padding: 0 5px; border: 0; border-radius: 4px; background: transparent; color: var(--x-text); font: inherit; cursor: pointer; }
#tb button:hover { background: var(--x-line); }
#tb button.on { background: color-mix(in srgb, var(--x-acc) 22%, transparent); }
#tb .sep { flex: none; width: 1px; height: 18px; margin: 0 4px; background: var(--x-line); }
#tb select { flex: none; height: 26px; border: 0; border-radius: 4px; background: transparent; color: var(--x-text); font: inherit; }
#fb { flex: none; display: flex; align-items: center; border-bottom: 1px solid var(--x-line); }
#fb input { border: 0; outline: 0; background: transparent; color: var(--x-text); font: 13px Arial, sans-serif; height: 24px; padding: 0 8px; }
#nb { width: 84px; border-right: 1px solid var(--x-line) !important; text-align: center; }
#fb .fx { color: var(--x-dim); font-style: italic; padding: 0 2px 0 8px; }
#fi { flex: 1; min-width: 0; }
#gw { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: 44px 1fr; grid-template-rows: 22px 1fr; }
#corner, #ch, #rh { background: var(--x-panel); position: relative; overflow: hidden; }
#corner { border-right: 1px solid var(--x-line); border-bottom: 1px solid var(--x-line); cursor: pointer; }
#ch { border-bottom: 1px solid var(--x-line); }
#rh { border-right: 1px solid var(--x-line); }
.h { position: absolute; display: flex; align-items: center; justify-content: center; color: var(--x-dim); font-size: 12px; user-select: none; border-right: 1px solid var(--x-line); border-bottom: 1px solid var(--x-line); cursor: pointer; }
.h.sel { background: color-mix(in srgb, var(--x-acc) 18%, var(--x-panel)); color: var(--x-text); }
#ch .h { top: 0; height: 100%; } #rh .h { left: 0; width: 100%; }
#mn { position: relative; overflow: auto; outline: 0; -webkit-overflow-scrolling: touch; }
#sz { position: relative; }
.c { position: absolute; padding: 0 4px; display: flex; align-items: center; overflow: hidden; white-space: nowrap; border-right: 1px solid var(--x-grid); border-bottom: 1px solid var(--x-grid); font-family: Arial, sans-serif; }
.c > span.t { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.c.wr { white-space: normal; align-items: flex-start; padding-top: 2px; overflow: hidden; }
.c.err { color: #d93025; }
.c .cb { flex: none; width: 18px; height: 18px; margin: 0 auto; border: 2px solid #8a98c0; border-radius: 4px; display: block; position: relative; }
.c .cb.on { background: #5b7cd6; border-color: #5b7cd6; }
.c .cb.on::after { content: ""; position: absolute; left: 4px; top: 0; width: 5px; height: 9px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.c .chip { max-width: 100%; padding: 1px 8px; border-radius: 10px; color: #202124; overflow: hidden; text-overflow: ellipsis; }
.c .arr { flex: none; margin-left: auto; padding-left: 4px; color: var(--x-dim); font-size: 9px; }
#selr { position: absolute; pointer-events: none; border: 2px solid var(--x-acc); background: color-mix(in srgb, var(--x-acc) 10%, transparent); z-index: 2; }
#fill { position: absolute; width: 9px; height: 9px; background: var(--x-acc); border: 1px solid var(--x-bg); z-index: 3; cursor: crosshair; }
#ed { position: absolute; z-index: 5; margin: 0; padding: 0 4px; border: 2px solid var(--x-acc); border-radius: 0; outline: 0; resize: none; overflow: hidden; background: var(--x-bg); color: var(--x-text); font: 13px Arial, sans-serif; white-space: pre; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
#ed.proxy { opacity: 0; width: 1px !important; height: 1px !important; min-width: 0 !important; border: 0; padding: 0; box-shadow: none; pointer-events: none; }
#rzc, #rzr { position: absolute; z-index: 4; pointer-events: none; display: none; background: var(--x-text); border-radius: 2px; }
#ch, #rh, #fill { touch-action: none; }
@media (pointer: coarse) { #fill { width: 22px; height: 22px; border-radius: 50%; margin: -7px 0 0 -7px; } }
.menu .edit { margin-top: 4px; padding: 7px 8px 3px; border-top: 1px solid var(--x-line); border-radius: 0; text-align: right; color: var(--x-dim); font-size: 15px; }
.fmt { min-width: 220px; max-height: 300px; overflow: auto; padding: 4px; }
.fmt .it, .fmt .sub div { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-radius: 4px; cursor: pointer; }
.fmt .it:hover, .fmt .sub div:hover { background: var(--x-panel); }
.fmt .sub { padding-left: 14px; border-left: 2px solid var(--x-line); margin: 0 0 4px 10px; }
.fmt .sub .sw { display: inline-block; width: 90px; height: 12px; border-radius: 2px; border: 1px solid var(--x-line); }
.fmt hr { border: 0; border-top: 1px solid var(--x-line); margin: 4px 0; }
.cfd { width: 290px; max-height: 300px; overflow: auto; }
.cfd input[type=text], .cfd select { display: block; width: 100%; margin: 0 0 6px; padding: 4px; font: 13px Arial, sans-serif; background: var(--x-bg); color: var(--x-text); border: 1px solid var(--x-line); border-radius: 4px; }
.cfd .st { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.cfd .st select { width: auto; margin: 0; }
.cfd .rule { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-top: 1px solid var(--x-line); font-size: 12px; }
.cfd .rule span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfd .rule i { padding: 0 6px; border-radius: 3px; font-style: normal; }
.cfd .rule b { cursor: pointer; color: var(--x-dim); }
.cfd .err { color: #d93025; font-size: 12px; margin: 0 0 6px; }
#more { position: absolute; left: 6px; color: var(--x-acc); cursor: pointer; font-size: 12px; user-select: none; }
#st { flex: none; display: flex; align-items: center; height: 22px; padding: 0 8px; color: var(--x-dim); font-size: 12px; border-top: 1px solid var(--x-line); background: var(--x-panel); }
#stat { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#grip { flex: none; width: 60px; height: 100%; cursor: ns-resize; position: relative; touch-action: none; }
#grip::after { content: ""; position: absolute; left: 14px; right: 14px; top: 9px; height: 3px; border-radius: 2px; background: var(--x-dim); opacity: .5; }
.pop { position: absolute; z-index: 20; padding: 6px; background: var(--x-bg); border: 1px solid var(--x-line); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.28); }
.pal { display: grid; grid-template-columns: repeat(10, 18px); gap: 3px; }
.pal i { width: 18px; height: 18px; border-radius: 3px; border: 1px solid rgba(0,0,0,.18); cursor: pointer; }
.pop .reset { margin-top: 6px; color: var(--x-acc); cursor: pointer; font-size: 12px; }
.menu { min-width: 130px; padding: 4px; }
.menu div { padding: 4px 8px; border-radius: 4px; cursor: pointer; }
.menu div:hover { background: var(--x-panel); }
.menu .chip { padding: 1px 8px; border-radius: 10px; color: #202124; }
.dd .ddrows { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; margin-bottom: 6px; width: 240px; }
.dd .ddrow { display: flex; align-items: center; gap: 6px; }
.dd .grip { flex: none; color: var(--x-dim); font-size: 15px; line-height: 1; letter-spacing: -2px; cursor: grab; touch-action: none; user-select: none; }
.dd .ddswatch { flex: none; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--x-line); cursor: pointer; padding: 0; }
.dd .ddrow input[type=text] { flex: 1; min-width: 0; padding: 4px 6px; font: 13px Arial, sans-serif; background: var(--x-bg); color: var(--x-text); border: 1px solid var(--x-line); border-radius: 4px; }
.dd .ddtrash { flex: none; cursor: pointer; font-size: 13px; padding: 2px 4px; border-radius: 3px; }
.dd .ddtrash:hover { background: var(--x-panel); }
.dd .ddadd { color: var(--x-acc); cursor: pointer; font-size: 13px; padding: 4px 0 8px; }
.dd .ddpal { display: grid; grid-template-columns: repeat(10, 16px); gap: 3px; margin: -2px 0 6px 28px; padding: 6px; background: var(--x-panel); border-radius: 6px; width: fit-content; }
.dd .ddpal i { width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(0, 0, 0, 0.18); cursor: pointer; }
.dd p { margin: 0 0 4px; color: var(--x-dim); font-size: 12px; }
.dd .row { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
.dd button { border: 1px solid var(--x-line); background: var(--x-panel); color: var(--x-text); border-radius: 4px; padding: 3px 10px; cursor: pointer; font: inherit; }
`;

const PALETTE = (() => {
  const gray = ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"];
  const hues = ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"];
  const tints = (mix) => hues.map((h) => {
    const n = parseInt(h.slice(1), 16);
    const ch = (s) => Math.round(((n >> s) & 255) * (1 - mix) + 255 * mix).toString(16).padStart(2, "0");
    return "#" + ch(16) + ch(8) + ch(0);
  });
  return [...gray, ...hues, ...tints(0.6), ...tints(0.8), ...tints(0.9)];
})();
const CHIP_COLORS = ["#fce8b2", "#b7e1cd", "#c9daf8", "#f4cccc", "#d9d2e9", "#d0e0e3", "#fff2cc", "#ead1dc"];

/** Black or white text, whichever reads better on the fill colour `bg` (so a light fill works on a dark page). */
function readableOn(bg) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  const n = parseInt(h, 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#202124" : "#ffffff";
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function startGrid(root, model, source, block) {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  root.innerHTML = `<div id="app">
    <div id="tb">
      <button data-a="undo" title="Undo (Ctrl+Z)">↶</button><button data-a="redo" title="Redo (Ctrl+Y)">↷</button><button data-a="fmt" title="Format menu">Format ▾</button><span class="sep"></span>
      <button data-a="b" title="Bold (Ctrl+B)"><b>B</b></button><button data-a="i" title="Italic (Ctrl+I)"><i>I</i></button><button data-a="u" title="Underline (Ctrl+U)"><u>U</u></button><button data-a="s" title="Strikethrough"><s>S</s></button>
      <button data-a="fg" title="Text colour"><span style="border-bottom:3px solid #d93025">A</span></button><button data-a="bg" title="Fill colour"><span style="display:inline-block;width:13px;height:13px;vertical-align:middle;background:#fff2cc;border:1px solid #888"></span></button><span class="sep"></span>
      <button data-a="al-l" title="Align left">⇤</button><button data-a="al-c" title="Centre">↔</button><button data-a="al-r" title="Align right">⇥</button><button data-a="wr" title="Wrap text">↵</button><button data-a="bd" title="Borders">▦</button><span class="sep"></span>
      <select data-a="nf" title="Number format"><option value="">Auto</option><option value="num">Number</option><option value="int">Integer</option><option value="cur">Currency</option><option value="pct">Percent</option><option value="date">Date</option><option value="text">Plain text</option></select>
      <button data-a="dp-" title="Fewer decimals">.0←</button><button data-a="dp+" title="More decimals">.00→</button><span class="sep"></span>
      <button data-a="chk" title="Checkbox">☑</button><button data-a="list" title="Dropdown">▾≡</button><span class="sep"></span>
      <button data-a="row+" title="Insert row above">＋row</button><button data-a="col+" title="Insert column left">＋col</button><button data-a="row-" title="Delete selected rows">−row</button><button data-a="col-" title="Delete selected columns">−col</button><span class="sep"></span>
      <button data-a="asc" title="Sort A→Z by the active column">A→Z</button><button data-a="desc" title="Sort Z→A">Z→A</button><button data-a="fd" title="Fill down (Ctrl+D)">↓fill</button><span class="sep"></span>
      <button data-a="src" title="Show this sheet as text">&lt;/&gt;</button><button data-a="del" title="Delete this spreadsheet">🗑</button>
    </div>
    <div id="fb"><input id="nb" spellcheck="false" autocomplete="off"><span class="fx">fx</span><input id="fi" spellcheck="false" autocomplete="off"></div>
    <div id="gw"><div id="corner"></div><div id="ch"></div><div id="rh"></div><div id="rzc"></div><div id="rzr"></div><div id="mn" tabindex="0"><div id="sz"><div id="cells"></div><div id="selr"></div><div id="fill"></div><textarea id="ed" class="proxy" rows="1" spellcheck="false" autocomplete="off"></textarea><div id="more"></div></div></div></div>
    <div id="st"><span id="stat"></span><span id="grip" title="Drag to change the height"></span></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const mn = $("#mn"), sz = $("#sz"), cellsEl = $("#cells"), chEl = $("#ch"), rhEl = $("#rh"), selr = $("#selr"), fillH = $("#fill"), ed = $("#ed"), more = $("#more");
  const nb = $("#nb"), fi = $("#fi"), stat = $("#stat"), tb = $("#tb"), app = $("#app");

  let ev = makeEvaluator(model);
  let xs = [], ys = [];
  let anchor = { r: 0, c: 0 }, focus = { r: 0, c: 0 };
  let editing = null; // { r, c }
  let undo = [], redo = [];
  let clip = null; // last copy: { text, cells: [[cell|null]] }
  let lastSaved = source;
  let popup = null;
  const RH = 24, CW = 100, HEAD_H = 22;
  // With a mouse and keyboard, an invisible textarea keeps the focus (like Google Sheets) so typing, IME input (Thai!),
  // copy and paste all arrive as ordinary text events. On a touch screen it would pop the keyboard up on every tap,
  // so there the grid itself takes the focus and a second tap starts editing.
  const proxyMode = !matchMedia("(pointer: coarse)").matches;
  const focusGrid = () => (proxyMode ? ed.focus({ preventScroll: true }) : mn.focus({ preventScroll: true }));

  let hidden = new Set(); // rows a table filter hides (height 0)
  const rowH = (r) => (hidden.has(r) ? 0 : Number(model.rh[r + 1]) || RH);
  const colW = (c) => Number(model.w[colName(c)]) || CW;
  function layout() {
    hidden = hiddenRows(model, ev);
    xs = [0];
    for (let c = 0; c < model.cols; c++) xs.push(xs[c] + colW(c));
    ys = [0];
    for (let r = 0; r < model.rows; r++) ys.push(ys[r] + rowH(r));
    sz.style.width = xs[model.cols] + 2 + "px";
    sz.style.height = ys[model.rows] + 34 + "px";
    more.style.top = ys[model.rows] + 8 + "px";
    more.textContent = model.rows < MAX_ROWS ? "+ 20 more rows" : "";
  }
  const at = (arr, x) => {
    let lo = 0, hi = arr.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const sel = () => expandForMerges({ r1: Math.min(anchor.r, focus.r), r2: Math.max(anchor.r, focus.r), c1: Math.min(anchor.c, focus.c), c2: Math.max(anchor.c, focus.c) }, model.merges);
  const cellAt = (r, c) => model.cells[cellKey(c, r)];
  const valueAt = (r, c) => ev.cell(c, r);
  function each(fn) {
    const s = sel();
    for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) fn(r, c);
  }

  /** The sheet's own colour theme and font (or, by default, the note's colours). */
  function applyTheme() {
    for (const c of [...app.classList]) if (c.startsWith("th-") || c.startsWith("ff-")) app.classList.remove(c);
    if (model.th) app.classList.add("th-" + model.th);
    if (model.ff) app.classList.add("ff-" + model.ff);
  }

  // ── change / undo / save ──
  const snapshot = () => JSON.stringify({ cols: model.cols, rows: model.rows, w: model.w, rh: model.rh, cells: model.cells, merges: model.merges, cf: model.cf, alt: model.alt, tables: model.tables, th: model.th, ff: model.ff });
  function restore(s) {
    Object.assign(model, JSON.parse(s));
    refresh();
  }
  function mutate(fn) {
    undo.push(snapshot());
    if (undo.length > 100) undo.shift();
    redo = [];
    fn();
    refresh();
    scheduleSave();
  }
  function refresh() {
    ev = makeEvaluator(model);
    model.merges = model.merges.filter((m) => m.r2 < model.rows && m.c2 < model.cols);
    applyTheme();
    anchor.r = Math.min(anchor.r, model.rows - 1); focus.r = Math.min(focus.r, model.rows - 1);
    anchor.c = Math.min(anchor.c, model.cols - 1); focus.c = Math.min(focus.c, model.cols - 1);
    layout();
    paint();
    syncBars();
  }
  // Saved straight away, not debounced: the note removes this frame the moment you open another note, and a
  // pending timer would die with it (and take your last edit along).
  const scheduleSave = () => flush();
  function flush() {
    const text = serializeSheet(model);
    if (text === lastSaved) return;
    lastSaved = text;
    block.save(text);
  }
  function doUndo() {
    const s = undo.pop();
    if (s === undefined) return;
    redo.push(snapshot());
    restore(s);
    scheduleSave();
  }
  function doRedo() {
    const s = redo.pop();
    if (s === undefined) return;
    undo.push(snapshot());
    restore(s);
    scheduleSave();
  }

  function setRaw(r, c, text) {
    const k = cellKey(c, r);
    const cell = model.cells[k] ? { ...model.cells[k] } : {};
    if (cell.t === "chk") text = /^(true|1|yes)$/i.test(text.trim()) ? "TRUE" : "FALSE";
    if (text === "") delete cell.v;
    else {
      cell.v = text;
      const f = text[0] !== "=" && !cell.nf ? inferFormat(text) : null;
      if (f) Object.assign(cell, f);
    }
    if (Object.keys(cell).length === 0) delete model.cells[k];
    else model.cells[k] = cell;
  }
  function growTo(r, c) {
    if (r >= model.rows) model.rows = Math.min(MAX_ROWS, r + 1);
    if (c >= model.cols) model.cols = Math.min(MAX_COLS, c + 1);
  }

  // ── painting ──
  /** The alternating-colour fill for a cell, if it is inside one. */
  function altAt(r, c) {
    for (const a of model.alt) {
      if (!inRect(a, r, c)) continue;
      const head = r === a.r1 && !!a.h;
      return { head, bg: head ? a.h : (r - a.r1) % 2 === 1 ? a.b : a.a };
    }
    return null;
  }
  /** The first conditional-formatting rule that matches this cell. */
  function ruleAt(r, c, v, shown) {
    for (const rule of model.cf) {
      if (!inRect(rule, r, c)) continue;
      const f = rule.k === "formula" ? ev.formula(shiftFormula("=" + String(rule.v || "").replace(/^=/, ""), r - rule.r1, c - rule.c1)) : undefined;
      if (cfTest(rule, v, shown, f)) return rule;
    }
    return null;
  }
  const tableAt = (r, c) => model.tables.find((t) => inRect(t, r, c)) || null;
  /** Can text from the cell to the left flow over this one? Only if it is empty and plain. */
  const spillable = (r, c) => valueAt(r, c) === null && !cellAt(r, c)?.bg && !altAt(r, c) && !mergeAt(model.merges, r, c) && !ruleAt(r, c, null, "");
  function cellHtml(r, c, x, y, w, h, merged) {
    const cell = cellAt(r, c);
    const v = valueAt(r, c);
    const shown = display(v, cell);
    const rule = ruleAt(r, c, v, shown);
    const alt = altAt(r, c);
    const bg = rule?.bg || cell?.bg || alt?.bg;
    const fg = rule?.fg || cell?.fg || (bg ? readableOn(bg) : null);
    let css = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
    let cls = "c";
    const err = v instanceof XErr;
    if (err) cls += " err";
    if (bg) css += `background:${esc(bg)};`;
    if (fg) css += `color:${esc(fg)};`;
    if (cell?.b || rule?.bold || alt?.head) css += "font-weight:700;";
    if (cell?.fs) css += `font-size:${Number(cell.fs)}px;`;
    if (cell) {
      if (cell.i) css += "font-style:italic;";
      const deco = [cell.u ? "underline" : "", cell.s ? "line-through" : ""].filter(Boolean).join(" ");
      if (deco) css += `text-decoration:${deco};`;
      if (cell.bd) css += "box-shadow:inset 0 0 0 1px var(--x-text);";
      if (cell.wr === 1) cls += " wr";
      if (cell.va) css += `align-items:${cell.va === "t" ? "flex-start" : cell.va === "b" ? "flex-end" : "center"};`;
    }
    const num = typeof v === "number" || (cell?.nf && typeof v !== "string");
    const align = cell?.al === "c" ? "center" : cell?.al === "r" ? "flex-end" : cell?.al === "l" ? "flex-start" : num && !cell?.t ? "flex-end" : err || typeof v === "boolean" ? "center" : "flex-start";
    css += `justify-content:${align};`;
    let inner;
    const th = tableAt(r, c);
    const head = th && r === th.r1 ? { filtered: !!th.f?.[c - th.c1] } : null;
    if (cell?.t === "chk") inner = `<i class="cb${v === true ? " on" : ""}"></i>`;
    else if (cell?.t === "list") {
      const opt = (cell.opts || []).find((o) => o.l === shown);
      inner = shown ? `<span class="chip" style="background:${esc(opt?.c || "#e8eaed")}">${esc(shown)}</span><span class="arr">▼</span>` : `<span class="arr">▼</span>`;
    } else {
      const rot = cell?.rot;
      let tilt = "";
      if (rot === "u45" || rot === "d45") {
        tilt = ` style="transform:rotate(${rot === "u45" ? -45 : 45}deg);transform-origin:left center"`;
        cls += " rot";
      } else if (rot === "u90") tilt = ` style="writing-mode:vertical-rl;transform:rotate(180deg)"`;
      else if (rot === "d90") tilt = ` style="writing-mode:vertical-rl"`;
      inner = `<span class="t"${tilt}>${esc(shown)}</span>`;
      // Default wrapping is overflow: long left-aligned text runs over the empty cells to its right (Wrap and Clip stay inside).
      if (!merged && !tilt && !bg && !head && typeof v === "string" && cell?.wr !== 1 && cell?.wr !== "c" && align === "flex-start" && shown !== "" && !shown.includes("\n") && shown.length * 4 > w - 8) {
        const need = textWidth(cell, shown) + 10;
        let ww = w;
        let cc = c + 1;
        while (ww < need && cc < model.cols && spillable(r, cc)) ww += xs[cc + 1] - xs[cc++];
        if (ww > w) css += `width:${ww}px;z-index:1;background:var(--x-bg);`;
      }
    }
    if (head) inner += `<span class="arr tbl${head.filtered ? " on" : ""}">▼</span>`;
    return `<div class="${cls}" style="${css}">${inner}</div>`;
  }

  function paint() {
    const W = mn.clientWidth, H = mn.clientHeight, sx = mn.scrollLeft, sy = mn.scrollTop;
    const c0 = at(xs, sx), c1 = Math.min(model.cols - 1, at(xs, sx + W) + 1);
    const r0 = at(ys, sy), r1 = Math.min(model.rows - 1, at(ys, sy + H) + 1);
    let html = "";
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (ys[r + 1] === ys[r] || (model.merges.length && mergeAt(model.merges, r, c))) continue; // hidden row / drawn below, once, as one big cell
        html += cellHtml(r, c, xs[c], ys[r], xs[c + 1] - xs[c], ys[r + 1] - ys[r]);
      }
    }
    for (const m of model.merges) {
      if (m.r2 < r0 || m.r1 > r1 || m.c2 < c0 || m.c1 > c1) continue;
      html += cellHtml(m.r1, m.c1, xs[m.c1], ys[m.r1], xs[m.c2 + 1] - xs[m.c1], ys[m.r2 + 1] - ys[m.r1], true);
    }
    cellsEl.innerHTML = html;

    const s = sel();
    let hh = "";
    for (let c = c0; c <= c1; c++) hh += `<div class="h${c >= s.c1 && c <= s.c2 ? " sel" : ""}" style="left:${xs[c] - sx}px;width:${xs[c + 1] - xs[c]}px">${colName(c)}</div>`;
    chEl.innerHTML = hh;
    let rr = "";
    for (let r = r0; r <= r1; r++) rr += `<div class="h${r >= s.r1 && r <= s.r2 ? " sel" : ""}" style="top:${ys[r] - sy}px;height:${ys[r + 1] - ys[r]}px">${r + 1}</div>`;
    rhEl.innerHTML = rr;

    selr.style.cssText = `left:${xs[s.c1] - 1}px;top:${ys[s.r1] - 1}px;width:${xs[s.c2 + 1] - xs[s.c1] + 1}px;height:${ys[s.r2 + 1] - ys[s.r1] + 1}px;`;
    selr.style.background = s.r1 === s.r2 && s.c1 === s.c2 ? "transparent" : "";
    fillH.style.left = xs[s.c2 + 1] - 5 + "px";
    fillH.style.top = ys[s.r2 + 1] - 5 + "px";
    fillH.style.display = editing ? "none" : "";
    if (!editing) {
      ed.style.left = xs[anchor.c] + "px";
      ed.style.top = ys[anchor.r] + "px";
    }
  }

  function syncBars() {
    const s = sel();
    nb.value = s.r1 === s.r2 && s.c1 === s.c2 ? cellKey(s.c1, s.r1) : `${cellKey(s.c1, s.r1)}:${cellKey(s.c2, s.r2)}`;
    if (!editing) fi.value = cellAt(anchor.r, anchor.c)?.v ?? "";
    const cell = cellAt(anchor.r, anchor.c);
    for (const [a, on] of [["b", cell?.b], ["i", cell?.i], ["u", cell?.u], ["s", cell?.s], ["wr", cell?.wr === 1], ["bd", cell?.bd], ["chk", cell?.t === "chk"], ["list", cell?.t === "list"], ["al-l", cell?.al === "l"], ["al-c", cell?.al === "c"], ["al-r", cell?.al === "r"]]) {
      tb.querySelector(`[data-a="${a}"]`)?.classList.toggle("on", !!on);
    }
    tb.querySelector('[data-a="nf"]').value = cell?.nf || "";
    // Sheets-style summary of the numbers in a multi-cell selection.
    const nums = [];
    if ((s.r2 - s.r1 + 1) * (s.c2 - s.c1 + 1) > 1) {
      for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) {
        const v = valueAt(r, c);
        if (typeof v === "number") nums.push(v);
      }
    }
    stat.textContent = nums.length ? `Sum ${general(nums.reduce((a, b) => a + b, 0))}   Avg ${general(nums.reduce((a, b) => a + b, 0) / nums.length)}   Count ${nums.length}` : "";
  }

  function scrollTo(r, c) {
    const W = mn.clientWidth, H = mn.clientHeight;
    if (xs[c] < mn.scrollLeft) mn.scrollLeft = xs[c];
    else if (xs[c + 1] > mn.scrollLeft + W) mn.scrollLeft = Math.min(xs[c], xs[c + 1] - W);
    if (ys[r] < mn.scrollTop) mn.scrollTop = ys[r];
    else if (ys[r + 1] > mn.scrollTop + H) mn.scrollTop = Math.min(ys[r], ys[r + 1] - H);
  }
  function select(r, c, extend) {
    r = Math.max(0, r); c = Math.max(0, c);
    if (r >= model.rows || c >= model.cols) {
      if ((r >= model.rows && r < MAX_ROWS) || (c >= model.cols && c < MAX_COLS)) {
        growTo(r, c);
        layout();
      } else {
        r = Math.min(r, model.rows - 1); c = Math.min(c, model.cols - 1);
      }
    }
    focus = { r, c };
    if (!extend) {
      const m = mergeAt(model.merges, r, c);
      anchor = m ? { r: m.r1, c: m.c1 } : { r, c };
    }
    scrollTo(r, c);
    paint();
    syncBars();
  }

  // ── editing ──
  function startEdit(initial) {
    closePopup();
    const { r, c } = anchor;
    const cell = cellAt(r, c);
    if (cell?.t === "chk") return;
    const m = mergeAt(model.merges, r, c);
    const cellW = xs[(m ? m.c2 : c) + 1] - xs[c];
    const cellH = ys[(m ? m.r2 : r) + 1] - ys[r];
    editing = { r, c, h: cellH };
    ed.classList.remove("proxy");
    if (ed.value !== (initial ?? cell?.v ?? "")) ed.value = initial ?? cell?.v ?? "";
    const w = Math.max(cellW, 60);
    ed.style.left = xs[c] - 1 + "px";
    ed.style.top = ys[r] - 1 + "px";
    ed.style.minWidth = w + 2 + "px";
    ed.style.height = cellH + 2 + "px";
    fit();
    ed.focus({ preventScroll: true });
    ed.setSelectionRange(ed.value.length, ed.value.length);
    fi.value = ed.value;
    fillH.style.display = "none";
  }
  function fit() {
    ed.style.width = "0px";
    ed.style.width = Math.min(Math.max(ed.scrollWidth + 8, parseFloat(ed.style.minWidth)), mn.clientWidth - xs[editing?.c ?? 0] + mn.scrollLeft - 4) + "px";
    ed.style.height = Math.max((editing?.h ?? RH) + 2, ed.scrollHeight + 2) + "px";
  }
  function endEdit(commit) {
    if (!editing) return;
    const { r, c } = editing;
    const text = ed.value;
    editing = null;
    ed.classList.add("proxy");
    ed.value = "";
    if (commit && text !== (cellAt(r, c)?.v ?? "")) mutate(() => setRaw(r, c, text));
    else refresh();
  }
  ed.addEventListener("input", () => {
    if (!editing) {
      // Text typed while nothing was being edited: that is the start of an edit (keeps IME composition alive).
      if (ed.value === "" || cellAt(anchor.r, anchor.c)?.t === "chk" || cellAt(anchor.r, anchor.c)?.t === "list") {
        ed.value = "";
        return;
      }
      startEdit(ed.value);
      return;
    }
    fit();
    fi.value = ed.value;
  });
  ed.addEventListener("keydown", (e) => {
    if (!editing) {
      gridKey(e);
      return;
    }
    if (e.key === "Enter" && !e.altKey) {
      e.preventDefault();
      const { r } = editing;
      endEdit(true);
      select(r + (e.shiftKey ? -1 : 1), anchor.c, false);
      focusGrid();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const { c } = editing;
      endEdit(true);
      select(anchor.r, c + (e.shiftKey ? -1 : 1), false);
      focusGrid();
    } else if (e.key === "Escape") {
      e.preventDefault();
      endEdit(false);
      focusGrid();
    } else if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      ed.setRangeText("\n", ed.selectionStart, ed.selectionEnd, "end");
      fit();
    }
    e.stopPropagation();
  });
  ed.addEventListener("blur", () => setTimeout(() => editing && document.activeElement !== fi && endEdit(true), 0));
  fi.addEventListener("focus", () => {
    if (!editing) startEditFromBar();
  });
  function startEditFromBar() {
    const { r, c } = anchor;
    editing = { r, c, bar: true };
  }
  fi.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const { r, c } = anchor;
      editing = null;
      if (fi.value !== (cellAt(r, c)?.v ?? "")) mutate(() => setRaw(r, c, fi.value));
      select(r + 1, c, false);
      focusGrid();
    } else if (e.key === "Escape") {
      editing = null;
      syncBars();
      focusGrid();
    }
  });
  fi.addEventListener("blur", () => {
    if (editing?.bar) {
      const { r, c } = editing;
      editing = null;
      if (fi.value !== (cellAt(r, c)?.v ?? "")) mutate(() => setRaw(r, c, fi.value));
    }
  });
  nb.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const m = /^\s*([A-Za-z]{1,3}\d+)(?::([A-Za-z]{1,3}\d+))?\s*$/.exec(nb.value);
    const a = m && parseCellKey(m[1]);
    const b = m && (m[2] ? parseCellKey(m[2]) : a);
    if (a && b && a.r < model.rows && a.c < model.cols) {
      anchor = { r: a.r, c: a.c };
      focus = { r: Math.min(b.r, model.rows - 1), c: Math.min(b.c, model.cols - 1) };
      scrollTo(a.r, a.c);
      paint();
    }
    syncBars();
    focusGrid();
  });

  // ── popups (palette, dropdown menu, dropdown editor) ──
  function closePopup() {
    popup?.remove();
    popup = null;
  }
  function openPopup(html, x, y, cls) {
    closePopup();
    popup = document.createElement("div");
    popup.className = "pop " + (cls || "");
    popup.innerHTML = html;
    app.append(popup);
    const box = app.getBoundingClientRect();
    popup.style.left = Math.max(4, Math.min(x, box.width - popup.offsetWidth - 4)) + "px";
    popup.style.top = Math.max(4, Math.min(y, box.height - popup.offsetHeight - 4)) + "px";
    popup.addEventListener("pointerdown", (e) => e.stopPropagation());
    return popup;
  }
  function palette(kind, btn) {
    const b = btn.getBoundingClientRect(), a = app.getBoundingClientRect();
    const p = openPopup(`<div class="pal">${PALETTE.map((c) => `<i data-c="${c}" style="background:${c}"></i>`).join("")}</div><div class="reset">Reset</div>`, b.left - a.left, b.bottom - a.top + 2);
    p.addEventListener("click", (e) => {
      const c = e.target.dataset?.c;
      if (c || e.target.className === "reset") {
        applyStyle({ [kind]: c || undefined });
        closePopup();
      }
    });
  }
  function dropdownMenu(r, c) {
    const cell = cellAt(r, c);
    const opts = cell?.opts || [];
    const x = xs[c] - mn.scrollLeft + 44, y = ys[r + 1] - mn.scrollTop + HEAD_H + 88;
    const p = openPopup(opts.map((o, i) => `<div data-i="${i}"><span class="chip" style="background:${esc(o.c || "#e8eaed")}">${esc(o.l)}</span></div>`).join("") + `<div data-i="-1" style="color:var(--x-dim)">Clear</div><div class="edit" data-edit="1" title="Edit the dropdown">✎</div>`, x, y, "menu");
    p.addEventListener("click", (e) => {
      if (e.target.closest("[data-edit]")) {
        closePopup();
        dropdownEditor();
        return;
      }
      const d = e.target.closest("[data-i]");
      if (!d) return;
      const o = opts[Number(d.dataset.i)];
      mutate(() => setRaw(r, c, o ? o.l : ""));
      closePopup();
    });
  }
  /**
   * Edit a dropdown's options: one row per option, each with a colour swatch (click to pick), its label, a drag
   * handle to reorder and a trash button to remove it — like Sheets' "Data validation rules" editor.
   */
  function dropdownEditor() {
    const cell = cellAt(anchor.r, anchor.c);
    let rows = (cell?.opts?.length ? cell.opts : [{ l: "Item 1", c: CHIP_COLORS[0] }]).map((o) => ({ l: o.l, c: o.c || CHIP_COLORS[0] }));
    let openSwatch = -1;
    const btn = tb.querySelector('[data-a="list"]');
    const b = (btn || mn).getBoundingClientRect(), a = app.getBoundingClientRect();
    const rowHtml = (o, i) => `<div class="ddrow" data-i="${i}">
        <span class="grip" data-grip="${i}" title="Drag to reorder">⠿</span>
        <button class="ddswatch" data-sw="${i}" style="background:${esc(o.c)}" title="Colour"></button>
        <input type="text" data-l="${i}" value="${esc(o.l)}" spellcheck="false" placeholder="Option name">
        <span class="ddtrash" data-del="${i}" title="Remove">🗑</span>
      </div>${openSwatch === i ? `<div class="ddpal">${PALETTE.map((c) => `<i data-pick="${i}" data-c="${c}" style="background:${c}"></i>`).join("")}</div>` : ""}`;
    const html = () =>
      `<div class="dd"><p>Dropdown options</p><div class="ddrows">${rows.map(rowHtml).join("")}</div><div class="ddadd" data-x="add">+ Add another item</div><div class="row"><button data-x="off">Remove dropdown</button><button data-x="ok">Apply</button></div></div>`;
    const p = openPopup(html(), b.left - a.left - 60, b.bottom - a.top + 2);
    const refresh = () => (p.innerHTML = html());
    p.querySelector("input[type=text]")?.focus();
    let drag = null;
    p.addEventListener("click", (e) => {
      const pick = e.target.closest("[data-pick]");
      const sw = e.target.closest("[data-sw]");
      const del = e.target.closest("[data-del]");
      const x = e.target.dataset?.x;
      if (pick) {
        rows[Number(pick.dataset.pick)].c = pick.dataset.c;
        openSwatch = -1;
        refresh();
      } else if (sw) {
        openSwatch = openSwatch === Number(sw.dataset.sw) ? -1 : Number(sw.dataset.sw);
        refresh();
      } else if (del) {
        if (rows.length > 1) rows.splice(Number(del.dataset.del), 1);
        openSwatch = -1;
        refresh();
      } else if (x === "add") {
        rows.push({ l: `Option ${rows.length + 1}`, c: CHIP_COLORS[rows.length % CHIP_COLORS.length] });
        openSwatch = -1;
        refresh();
        [...p.querySelectorAll("input[type=text]")].pop()?.focus();
      } else if (x === "off" || x === "ok") {
        const opts = x === "off" ? [] : rows.map((o) => ({ l: o.l.trim(), c: o.c })).filter((o) => o.l !== "");
        applyStyle(opts.length ? { t: "list", opts } : { t: undefined, opts: undefined });
        closePopup();
      }
    });
    p.addEventListener("input", (e) => {
      const i = e.target.dataset?.l;
      if (i !== undefined) rows[Number(i)].l = e.target.value;
    });
    // Drag a row's grip up or down over its neighbours to reorder; a simple swap, not a smooth follow.
    p.addEventListener("pointerdown", (e) => {
      const g = e.target.closest("[data-grip]");
      if (g) {
        drag = Number(g.dataset.grip);
        e.preventDefault();
      }
    });
    p.addEventListener("pointermove", (e) => {
      if (drag === null) return;
      const to = Number(e.target.closest(".ddrow")?.dataset.i);
      if (Number.isInteger(to) && to !== drag) {
        rows.splice(to, 0, rows.splice(drag, 1)[0]);
        drag = to;
        refresh();
      }
    });
    p.addEventListener("pointerup", () => (drag = null));
  }

  // ── formatting ──
  function applyStyle(props) {
    mutate(() => each((r, c) => {
      const k = cellKey(c, r);
      const cell = { ...(model.cells[k] || {}), ...props };
      for (const p of Object.keys(props)) if (props[p] === undefined) delete cell[p];
      if (Object.keys(cell).length === 0) delete model.cells[k];
      else model.cells[k] = cell;
    }));
  }
  const toggle = (prop) => applyStyle({ [prop]: cellAt(anchor.r, anchor.c)?.[prop] ? undefined : 1 });

  // ── Format menu (like Sheets': Number, Text, Alignment, Wrapping, Font size, Merge, Conditional formatting, Alternating colours, Clear) ──
  const rectsIntersect = (a, b) => a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;
  function mergeCells(mode) {
    const s = sel();
    const parts = [];
    if (mode === "h") for (let r = s.r1; r <= s.r2; r++) parts.push({ r1: r, r2: r, c1: s.c1, c2: s.c2 });
    else if (mode === "v") for (let c = s.c1; c <= s.c2; c++) parts.push({ r1: s.r1, r2: s.r2, c1: c, c2: c });
    else parts.push(s);
    mutate(() => {
      model.merges = model.merges.filter((m) => !rectsIntersect(m, s));
      for (const g of parts) {
        if (g.r1 === g.r2 && g.c1 === g.c2) continue;
        model.merges.push(g);
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (r !== g.r1 || c !== g.c1) setRaw(r, c, ""); // only the top-left value is kept
      }
    });
  }
  function unmerge() {
    const s = sel();
    mutate(() => (model.merges = model.merges.filter((m) => !rectsIntersect(m, s))));
  }
  function clearFormatting() {
    mutate(() => each((r, c) => {
      const k = cellKey(c, r);
      const cell = model.cells[k];
      if (!cell) return;
      const keep = {};
      for (const p of ["v", "t", "opts"]) if (cell[p] !== undefined) keep[p] = cell[p];
      if (Object.keys(keep).length) model.cells[k] = keep;
      else delete model.cells[k];
    }));
  }
  function setAlternating(look) {
    const s = sel();
    const one = s.r1 === s.r2 && s.c1 === s.c2;
    const rect = one ? { r1: 0, c1: 0, r2: model.rows - 1, c2: model.cols - 1 } : s;
    mutate(() => (model.alt = look === null ? [] : [{ ...rect, ...look }]));
  }
  /** Pick your own header and row colours. */
  function altDialog() {
    const cur = model.alt[0] || ALT_PRESETS[0];
    const p = openPopup(`<div class="dd altd"><label>Header <input type="color" data-f="h" value="${esc(cur.h || "#4a86e8")}"></label><label>Row colour 1 <input type="color" data-f="a" value="${esc(cur.a)}"></label><label>Row colour 2 <input type="color" data-f="b" value="${esc(cur.b)}"></label><div class="row"><button data-x="close">Cancel</button><button data-x="ok">Apply</button></div></div>`, 12, 12);
    p.addEventListener("click", (e) => {
      const x = e.target.dataset?.x;
      if (x === "close") return closePopup();
      if (x !== "ok") return;
      const v = (n) => p.querySelector(`[data-f="${n}"]`).value;
      closePopup();
      setAlternating({ h: v("h"), a: v("a"), b: v("b") });
    });
  }

  // ── Tables: a header row with sort / filter arrows and banded rows ──
  function convertToTable() {
    const s = sel();
    let rect = s;
    if (s.r1 === s.r2 && s.c1 === s.c2) {
      // One cell: the block of filled cells that starts there (header row across, first column down).
      let c2 = s.c1;
      let r2 = s.r1;
      while (c2 + 1 < model.cols && valueAt(s.r1, c2 + 1) !== null) c2++;
      while (r2 + 1 < model.rows && valueAt(r2 + 1, s.c1) !== null) r2++;
      rect = { r1: s.r1, c1: s.c1, r2, c2 };
    }
    if (rect.r1 === rect.r2) return say("A table needs a header row and at least one row of data");
    mutate(() => {
      model.tables = model.tables.filter((t) => !rectsIntersect(t, rect)).concat([{ ...rect }]);
      model.alt = model.alt.filter((a) => !rectsIntersect(a, rect)).concat([{ ...rect, ...ALT_PRESETS[0] }]);
    });
  }
  const say = (m) => granite.notice(m);
  function tableMenu(t, c) {
    const x = xs[c] - mn.scrollLeft + 44;
    const y = ys[t.r1 + 1] - mn.scrollTop + HEAD_H + 88;
    const p = openPopup(`<div data-a="asc">Sort A → Z</div><div data-a="desc">Sort Z → A</div><hr><div data-a="flt">Filter by values…</div><div data-a="clr">Clear filter</div><hr><div data-a="off">Convert to range</div>`, x, y, "tmenu");
    p.addEventListener("click", (e) => {
      const a = e.target.dataset?.a;
      if (!a) return;
      const body = { r1: t.r1 + 1, r2: t.r2, c1: t.c1, c2: t.c2 };
      if (a === "asc" || a === "desc") {
        closePopup();
        sortRect(body, c, a === "desc");
      } else if (a === "clr") {
        closePopup();
        mutate(() => t.f && delete t.f[c - t.c1]);
      } else if (a === "off") {
        closePopup();
        mutate(() => {
          model.tables = model.tables.filter((x) => x !== t);
          model.alt = model.alt.filter((x) => !(x.r1 === t.r1 && x.c1 === t.c1 && x.r2 === t.r2 && x.c2 === t.c2));
        });
      } else if (a === "flt") filterList(t, c, x, y);
    });
  }
  function filterList(t, c, x, y) {
    const values = [];
    for (let r = t.r1 + 1; r <= t.r2; r++) {
      const shown = display(valueAt(r, c), cellAt(r, c));
      if (!values.includes(shown)) values.push(shown);
    }
    values.sort((a, b) => compare(literal(a), literal(b)));
    const allowed = t.f?.[c - t.c1];
    const html = values.map((v, i) => `<label><input type="checkbox" data-i="${i}" ${!allowed || allowed.includes(v) ? "checked" : ""}> ${esc(v === "" ? "(Blanks)" : v)}</label>`).join("");
    const p = openPopup(`<div data-a="all">Select all</div><div data-a="none">Clear</div><hr>${html}<hr><div data-a="ok"><b>OK</b></div>`, x, y, "tmenu");
    const boxes = () => [...p.querySelectorAll("input[type=checkbox]")];
    p.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "all") boxes().forEach((b) => (b.checked = true));
      else if (a === "none") boxes().forEach((b) => (b.checked = false));
      else if (a === "ok") {
        const keep = boxes().filter((b) => b.checked).map((b) => values[Number(b.dataset.i)]);
        closePopup();
        mutate(() => {
          if (keep.length === values.length) t.f && delete t.f[c - t.c1];
          else (t.f = t.f || {})[c - t.c1] = keep;
        });
      }
    });
  }
  const FMT = [
    { l: "Theme", sub: [["Match the note", "th:"], ["Light", "th:light"], ["Dark", "th:dark"], ["Sepia", "th:sepia"], ["Green", "th:green"], ["Sans-serif font", "ff:"], ["Serif font", "ff:serif"], ["Monospace font", "ff:mono"]] },
    { l: "Number", sub: [["Automatic", "nf:"], ["Number", "nf:num"], ["Integer", "nf:int"], ["Percent", "nf:pct"], ["Currency", "nf:cur"], ["Date", "nf:date"], ["Plain text", "nf:text"], ["More decimals", "dp+"], ["Fewer decimals", "dp-"]] },
    { l: "Text", sub: [["Bold", "b"], ["Italic", "i"], ["Underline", "u"], ["Strikethrough", "s"]] },
    { l: "Alignment", sub: [["Left", "al-l"], ["Centre", "al-c"], ["Right", "al-r"], ["Top", "va:t"], ["Middle", "va:m"], ["Bottom", "va:b"]] },
    { l: "Wrapping", sub: [["Overflow", "wr:o"], ["Wrap", "wr:on"], ["Clip", "wr:c"]] },
    { l: "Rotation", sub: [["None", "rot:"], ["Tilt up", "rot:u45"], ["Tilt down", "rot:d45"], ["Rotate up", "rot:u90"], ["Rotate down", "rot:d90"]] },
    { l: "Smart chips", sub: [["Dropdown", "list"], ["Checkbox", "chk"], ["Remove chip", "chip:"]] },
    { l: "Font size", sub: [["Default", "fs:"], ...[8, 9, 10, 11, 12, 14, 18, 24, 36].map((n) => [String(n), "fs:" + n])] },
    { l: "Merge cells", sub: [["Merge all", "merge:a"], ["Merge horizontally", "merge:h"], ["Merge vertically", "merge:v"], ["Unmerge", "unmerge"]] },
    { l: "Convert to table", act: "table" },
    { l: "Conditional formatting…", act: "cf" },
    { l: "Alternating colours", sub: [...ALT_PRESETS.map((a, i) => [`<span class="sw" style="background:linear-gradient(90deg,${a.h} 34%,${a.a} 34% 67%,${a.b} 67%)"></span>`, "alt:" + i]), ["Custom colours…", "alt:custom"], ["Remove alternating colours", "alt:off"]] },
    { l: "Clear formatting", act: "clear" },
  ];
  function doFormat(code) {
    const [k, arg] = code.split(":");
    if (k === "nf") applyStyle({ nf: arg || undefined, dp: undefined });
    else if (k === "va") applyStyle({ va: arg === "m" ? undefined : arg });
    else if (k === "wr") applyStyle({ wr: arg === "on" ? 1 : arg === "c" ? "c" : undefined });
    else if (k === "th" || k === "ff") mutate(() => (model[k] = arg || ""));
    else if (k === "rot") applyStyle({ rot: arg || undefined });
    else if (k === "chip") applyStyle({ t: undefined, opts: undefined });
    else if (k === "table") convertToTable();
    else if (k === "fs") applyStyle({ fs: arg ? Number(arg) : undefined });
    else if (k === "merge") mergeCells(arg);
    else if (k === "unmerge") unmerge();
    else if (k === "alt") arg === "custom" ? altDialog() : setAlternating(arg === "off" ? null : ALT_PRESETS[Number(arg)]);
    else if (k === "cf") cfDialog();
    else if (k === "clear") clearFormatting();
    else if (ACT[k]) ACT[k]();
  }
  function formatMenu(btn) {
    const b = btn.getBoundingClientRect(), a = app.getBoundingClientRect();
    let open = -1;
    const html = () => FMT.map((it, i) => `<div class="it" data-i="${i}"><span>${it.l}</span>${it.sub ? `<span>${open === i ? "▾" : "▸"}</span>` : ""}</div>` + (open === i ? `<div class="sub">${it.sub.map(([l, code]) => `<div data-code="${code}">${l}</div>`).join("")}</div>` : "")).join("");
    const p = openPopup(html(), b.left - a.left, b.bottom - a.top + 2, "fmt");
    p.addEventListener("click", (e) => {
      const code = e.target.closest("[data-code]")?.dataset.code;
      const item = e.target.closest("[data-i]");
      if (code !== undefined) {
        closePopup();
        doFormat(code);
      } else if (item) {
        const i = Number(item.dataset.i);
        if (FMT[i].act) {
          closePopup();
          doFormat(FMT[i].act);
        } else {
          open = open === i ? -1 : i;
          p.innerHTML = html();
        }
      }
    });
  }

  /** Conditional formatting: rules that colour cells by their value; the first matching rule wins. */
  function cfDialog(message) {
    const s = sel();
    const one = s.r1 === s.r2 && s.c1 === s.c2;
    const range = one ? `${cellKey(s.c1, 0)}:${cellKey(s.c1, model.rows - 1)}` : `${cellKey(s.c1, s.r1)}:${cellKey(s.c2, s.r2)}`;
    const FILLS = [["", "No fill"], ["#f4cccc", "Light red"], ["#fce8b2", "Light yellow"], ["#b7e1cd", "Light green"], ["#c9daf8", "Light blue"], ["#ea4335", "Red"], ["#fbbc04", "Orange"], ["#34a853", "Green"], ["#4285f4", "Blue"]];
    const TEXTS = [["", "Default"], ["#d93025", "Red"], ["#188038", "Green"], ["#1a73e8", "Blue"], ["#ffffff", "White"], ["#000000", "Black"]];
    const opt = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    const rules = model.cf.map((r, i) => `<div class="rule"><span>${cellKey(r.c1, r.r1)}:${cellKey(r.c2, r.r2)} · ${esc(CF_KINDS.find((k) => k[0] === r.k)?.[1] || r.k)} ${esc(r.v || "")}${r.v2 ? " and " + esc(r.v2) : ""}</span><i style="background:${esc(r.bg || "transparent")};color:${esc(r.fg || "inherit")};${r.bold ? "font-weight:700" : ""}">Aa</i><b data-del="${i}" title="Delete rule">✕</b></div>`).join("");
    const a = app.getBoundingClientRect();
    const p = openPopup(`<div class="dd cfd"><p>Apply to range</p><input type="text" data-f="range" value="${esc(range)}" spellcheck="false"><p>Format cells if…</p><select data-f="k">${CF_KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select><input type="text" data-f="v" placeholder="Value or formula" spellcheck="false" hidden><input type="text" data-f="v2" placeholder="and" spellcheck="false" hidden><p>Formatting style</p><div class="st">Fill <select data-f="bg">${opt(FILLS)}</select> Text <select data-f="fg">${opt(TEXTS)}</select> <label><input type="checkbox" data-f="bold"> Bold</label></div>${message ? `<p class="err">${esc(message)}</p>` : ""}<div class="row"><button data-x="close">Close</button><button data-x="add">Add rule</button></div>${rules}</div>`, 12, 12);
    void a;
    const f = (n) => p.querySelector(`[data-f="${n}"]`);
    const sync = () => {
      const k = f("k").value;
      f("v").hidden = k === "empty" || k === "notEmpty";
      f("v2").hidden = k !== "between";
      f("v").placeholder = k === "formula" ? "=$B2>100" : "Value";
    };
    f("k").addEventListener("change", sync);
    sync();
    p.addEventListener("click", (e) => {
      if (e.target.dataset?.del !== undefined) {
        mutate(() => model.cf.splice(Number(e.target.dataset.del), 1));
        cfDialog();
        return;
      }
      const x = e.target.dataset?.x;
      if (x === "close") return closePopup();
      if (x !== "add") return;
      const m = /^\s*([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?\s*$/.exec(f("range").value);
      if (!m) return cfDialog("Type a range like B2:B20");
      const a1 = parseCellKey(m[1] + m[2]);
      const a2 = m[3] ? parseCellKey(m[3] + m[4]) : a1;
      const rule = { r1: Math.min(a1.r, a2.r), c1: Math.min(a1.c, a2.c), r2: Math.max(a1.r, a2.r), c2: Math.max(a1.c, a2.c), k: f("k").value, v: f("v").value, v2: f("v2").value, bg: f("bg").value, fg: f("fg").value, bold: f("bold").checked ? 1 : 0 };
      for (const key of ["bg", "fg", "bold", "v", "v2"]) if (!rule[key]) delete rule[key];
      if (!rule.bg && !rule.fg && !rule.bold) return cfDialog("Pick a fill, a text colour or bold");
      mutate(() => model.cf.push(rule));
      cfDialog();
    });
  }

  // ── structure ──
  function moveCells(mapKey, adjust) {
    const next = {};
    for (const [k, cell] of Object.entries(model.cells)) {
      const p = parseCellKey(k);
      const to = mapKey(p);
      if (!to) continue;
      const copy = { ...cell };
      if (typeof copy.v === "string" && copy.v[0] === "=") copy.v = adjust(copy.v);
      next[cellKey(to.c, to.r)] = copy;
    }
    model.cells = next;
  }
  function shiftSizes(axis, index, count) {
    const o = axis === "c" ? model.w : model.rh;
    const next = {};
    for (const [k, v] of Object.entries(o)) {
      const i = axis === "c" ? colIndex(k) : Number(k) - 1;
      const to = count > 0 ? (i >= index ? i + count : i) : i >= index - count ? i + count : i >= index ? -1 : i;
      if (to >= 0) next[axis === "c" ? colName(to) : String(to + 1)] = v;
    }
    if (axis === "c") model.w = next;
    else model.rh = next;
  }
  /** Merged cells, formatting rules and alternating colours follow rows/columns that are inserted or deleted. */
  function fixRects(axis, index, count) {
    const fix = (list) => list.map((x) => adjustRect(x, axis, index, count)).filter(Boolean);
    model.merges = fix(model.merges).filter((m) => m.r1 !== m.r2 || m.c1 !== m.c2);
    model.cf = fix(model.cf);
    model.alt = fix(model.alt);
    model.tables = fix(model.tables);
  }
  function insertLines(axis, index, count) {
    mutate(() => {
      moveCells((p) => (axis === "r" ? { c: p.c, r: p.r >= index ? p.r + count : p.r } : { r: p.r, c: p.c >= index ? p.c + count : p.c }), (f) => adjustForLines(f, axis, index, count));
      shiftSizes(axis, index, count);
      fixRects(axis, index, count);
      if (axis === "r") model.rows = Math.min(MAX_ROWS, model.rows + count);
      else model.cols = Math.min(MAX_COLS, model.cols + count);
    });
  }
  function deleteLines(axis, index, count) {
    if ((axis === "r" ? model.rows : model.cols) <= count) return;
    mutate(() => {
      const end = index + count;
      moveCells((p) => {
        const i = axis === "r" ? p.r : p.c;
        if (i >= index && i < end) return null;
        const j = i >= end ? i - count : i;
        return axis === "r" ? { c: p.c, r: j } : { r: p.r, c: j };
      }, (f) => adjustForLines(f, axis, index, -count));
      shiftSizes(axis, index, -count);
      fixRects(axis, index, -count);
      if (axis === "r") model.rows -= count;
      else model.cols -= count;
    });
  }
  function sortSelection(desc) {
    sortRect(sel(), anchor.c, desc);
  }
  function sortRect(s, keyCol, desc) {
    const rows = [];
    for (let r = s.r1; r <= s.r2; r++) rows.push({ r, key: valueAt(r, keyCol), cells: Array.from({ length: s.c2 - s.c1 + 1 }, (_, i) => cellAt(r, s.c1 + i) || null) });
    rows.sort((a, b) => {
      if (a.key === null && b.key !== null) return 1;
      if (b.key === null && a.key !== null) return -1;
      return (desc ? -1 : 1) * compare(a.key instanceof XErr ? a.key.code : a.key, b.key instanceof XErr ? b.key.code : b.key) || a.r - b.r;
    });
    mutate(() => rows.forEach((row, i) => row.cells.forEach((cell, j) => {
      const k = cellKey(s.c1 + j, s.r1 + i);
      if (!cell) delete model.cells[k];
      else model.cells[k] = { ...cell, ...(cell.v?.[0] === "=" ? { v: shiftFormula(cell.v, s.r1 + i - row.r, 0) } : {}) };
    })));
  }

  // ── clipboard, fill ──
  function copyText() {
    const s = sel();
    const lines = [];
    const cells = [];
    for (let r = s.r1; r <= s.r2; r++) {
      const row = [], line = [];
      for (let c = s.c1; c <= s.c2; c++) {
        row.push(cellAt(r, c) ? { ...cellAt(r, c) } : null);
        line.push(display(valueAt(r, c), cellAt(r, c)));
      }
      cells.push(row);
      lines.push(line.join("\t"));
    }
    clip = { text: lines.join("\n"), cells, r: s.r1, c: s.c1 };
    return clip.text;
  }
  function paste(text) {
    const { r: r0, c: c0 } = { r: sel().r1, c: sel().c1 };
    mutate(() => {
      if (clip && clip.text === text) {
        clip.cells.forEach((row, i) => row.forEach((cell, j) => {
          const k = cellKey(c0 + j, r0 + i);
          growTo(r0 + i, c0 + j);
          if (!cell) delete model.cells[k];
          else model.cells[k] = { ...cell, ...(cell.v?.[0] === "=" ? { v: shiftFormula(cell.v, r0 + i - clip.r, c0 + j - clip.c) } : {}) };
        }));
      } else {
        text.replace(/\r/g, "").replace(/\n$/, "").split("\n").forEach((line, i) => line.split("\t").forEach((v, j) => {
          growTo(r0 + i, c0 + j);
          if (r0 + i < model.rows && c0 + j < model.cols) setRaw(r0 + i, c0 + j, v);
        }));
      }
    });
  }
  function clearCells() {
    mutate(() => each((r, c) => setRaw(r, c, "")));
  }
  /** Repeat `src` into `dst` (an axis-aligned extension of it); a run of numbers with a fixed step continues as a series. */
  function fill(src, dst) {
    const down = dst.r2 > src.r2, up = dst.r1 < src.r1, right = dst.c2 > src.c2, left = dst.c1 < src.c1;
    mutate(() => {
      const vertical = down || up;
      const lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1;
      const n = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
      const extra = down ? dst.r2 - src.r2 : up ? src.r1 - dst.r1 : right ? dst.c2 - src.c2 : src.c1 - dst.c1;
      const sgn = down || right ? 1 : -1;
      for (let l = 0; l < lines; l++) {
        const at = (i) => (vertical ? cellAt(src.r1 + i, src.c1 + l) : cellAt(src.r1 + l, src.c1 + i));
        const nums = Array.from({ length: n }, (_, i) => { const v = at(i)?.v; return v !== undefined && v[0] !== "=" && typeof literal(v) === "number" ? literal(v) : null; });
        const step = n >= 2 && nums.every((x) => x !== null) && nums.every((x, i) => i === 0 || Math.abs(x - nums[i - 1] - (nums[1] - nums[0])) < 1e-9) ? nums[1] - nums[0] : null;
        for (let e = 1; e <= extra; e++) {
          const from = sgn > 0 ? (e - 1) % n : n - 1 - ((e - 1) % n);
          const cell = at(from);
          const r = vertical ? (sgn > 0 ? src.r2 + e : src.r1 - e) : src.r1 + l;
          const c = vertical ? src.c1 + l : sgn > 0 ? src.c2 + e : src.c1 - e;
          const k = cellKey(c, r);
          if (!cell) delete model.cells[k];
          else {
            const copy = { ...cell };
            if (step !== null && copy.v !== undefined) copy.v = String(sgn > 0 ? nums[n - 1] + step * e : nums[0] - step * e);
            else if (copy.v?.[0] === "=") copy.v = shiftFormula(copy.v, r - (vertical ? src.r1 + from : src.r1 + l), c - (vertical ? src.c1 + l : src.c1 + from));
            model.cells[k] = copy;
          }
        }
      }
    });
    anchor = { r: Math.min(src.r1, dst.r1), c: Math.min(src.c1, dst.c1) };
    focus = { r: Math.max(src.r2, dst.r2), c: Math.max(src.c2, dst.c2) };
    paint();
  }
  function fillDown() {
    const s = sel();
    if (s.r1 === s.r2) return;
    fill({ ...s, r2: s.r1 }, s);
  }
  /** True while the keyboard belongs to a text box (the cell editor, formula bar, name box, or a popup's fields). */
  const typingElsewhere = () => editing || document.activeElement === fi || document.activeElement === nb || !!popup?.contains(document.activeElement);
  document.addEventListener("copy", (e) => {
    if (typingElsewhere()) return;
    e.clipboardData.setData("text/plain", copyText());
    e.preventDefault();
  });
  document.addEventListener("cut", (e) => {
    if (typingElsewhere()) return;
    e.clipboardData.setData("text/plain", copyText());
    e.preventDefault();
    clearCells();
  });
  document.addEventListener("paste", (e) => {
    if (typingElsewhere()) return;
    e.preventDefault();
    paste(e.clipboardData.getData("text/plain"));
  });

  // ── keyboard ──
  const ACT = {
    undo: doUndo, redo: doRedo,
    b: () => toggle("b"), i: () => toggle("i"), u: () => toggle("u"), s: () => toggle("s"),
    "al-l": () => applyStyle({ al: cellAt(anchor.r, anchor.c)?.al === "l" ? undefined : "l" }),
    "al-c": () => applyStyle({ al: cellAt(anchor.r, anchor.c)?.al === "c" ? undefined : "c" }),
    "al-r": () => applyStyle({ al: cellAt(anchor.r, anchor.c)?.al === "r" ? undefined : "r" }),
    wr: () => toggle("wr"), bd: () => toggle("bd"),
    "dp+": () => applyStyle({ dp: Math.min(10, (cellAt(anchor.r, anchor.c)?.dp ?? (cellAt(anchor.r, anchor.c)?.nf === "int" ? 0 : cellAt(anchor.r, anchor.c)?.nf ? 2 : 0)) + 1) }),
    "dp-": () => applyStyle({ dp: Math.max(0, (cellAt(anchor.r, anchor.c)?.dp ?? (cellAt(anchor.r, anchor.c)?.nf ? 2 : 0)) - 1) }),
    chk: () => {
      const on = cellAt(anchor.r, anchor.c)?.t === "chk";
      mutate(() => each((r, c) => {
        const k = cellKey(c, r);
        const cell = { ...(model.cells[k] || {}) };
        if (on) delete cell.t;
        else {
          cell.t = "chk";
          cell.v = /^true$/i.test(cell.v || "") ? "TRUE" : "FALSE";
          delete cell.opts;
        }
        if (Object.keys(cell).length) model.cells[k] = cell;
        else delete model.cells[k];
      }));
    },
    list: dropdownEditor,
    "row+": () => insertLines("r", sel().r1, sel().r2 - sel().r1 + 1),
    "col+": () => insertLines("c", sel().c1, sel().c2 - sel().c1 + 1),
    "row-": () => deleteLines("r", sel().r1, sel().r2 - sel().r1 + 1),
    "col-": () => deleteLines("c", sel().c1, sel().c2 - sel().c1 + 1),
    asc: () => sortSelection(false), desc: () => sortSelection(true), fd: fillDown,
    src: () => {
      flush();
      block.edit();
    },
    del: () => {
      // Two clicks, so one stray tap can't throw a whole sheet away.
      const btn = tb.querySelector('[data-a="del"]');
      if (btn.dataset.armed) return block.remove();
      btn.dataset.armed = "1";
      btn.textContent = "Delete?";
      setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = "🗑";
      }, 3000);
    },
  };
  tb.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
  tb.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const a = btn.dataset.a;
    if (a === "fg" || a === "bg") palette(a, btn);
    else if (a === "fmt") formatMenu(btn);
    else if (ACT[a]) {
      closePopup();
      ACT[a]();
    }
  });
  tb.querySelector('[data-a="nf"]').addEventListener("change", (e) => {
    applyStyle({ nf: e.target.value || undefined, dp: undefined });
    focusGrid();
  });

  function gridKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const jump = (dr, dc) => {
      let r = focus.r, c = focus.c;
      const inside = (rr, cc) => rr >= 0 && rr < model.rows && cc >= 0 && cc < model.cols;
      if (!mod) {
        const m = e.shiftKey ? null : mergeAt(model.merges, r, c);
        if (m) {
          // Leave a merged cell from its edge, not from the corner the cursor happens to be on.
          if (dr > 0) r = m.r2;
          if (dr < 0) r = m.r1;
          if (dc > 0) c = m.c2;
          if (dc < 0) c = m.c1;
        }
        r += dr;
        c += dc;
        while (dr !== 0 && hidden.has(r) && inside(r, c)) r += dr;
      } else {
        // Ctrl+arrow: to the edge of the block of filled cells, or to the next filled cell.
        const filled = (rr, cc) => valueAt(rr, cc) !== null;
        const startFilled = filled(r, c) && inside(r + dr, c + dc) && filled(r + dr, c + dc);
        if (startFilled) while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc; }
        else {
          do { r += dr; c += dc; } while (inside(r, c) && !filled(r, c));
          if (!inside(r, c)) { r -= dr; c -= dc; }
        }
      }
      select(r, c, e.shiftKey);
    };
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
      if (k === "y") { e.preventDefault(); doRedo(); return; }
      if (k === "b") { e.preventDefault(); ACT.b(); return; }
      if (k === "i") { e.preventDefault(); ACT.i(); return; }
      if (k === "u") { e.preventDefault(); ACT.u(); return; }
      if (k === "d") { e.preventDefault(); fillDown(); return; }
      if (k === "a") { e.preventDefault(); anchor = { r: 0, c: 0 }; focus = { r: model.rows - 1, c: model.cols - 1 }; paint(); syncBars(); return; }
      if (k === "c" || k === "x" || k === "v") return; // the copy / cut / paste events handle these
    }
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); jump(-1, 0); break;
      case "ArrowDown": e.preventDefault(); jump(1, 0); break;
      case "ArrowLeft": e.preventDefault(); jump(0, -1); break;
      case "ArrowRight": e.preventDefault(); jump(0, 1); break;
      case "Tab": e.preventDefault(); select(anchor.r, anchor.c + (e.shiftKey ? -1 : 1), false); break;
      case "Enter": e.preventDefault(); if (cellAt(anchor.r, anchor.c)?.t === "list") dropdownMenu(anchor.r, anchor.c); else select(anchor.r + (e.shiftKey ? -1 : 1), anchor.c, false); break;
      case "Home": e.preventDefault(); select(mod ? 0 : focus.r, 0, e.shiftKey); break;
      case "End": e.preventDefault(); select(mod ? model.rows - 1 : focus.r, model.cols - 1, e.shiftKey); break;
      case "PageDown": e.preventDefault(); select(focus.r + Math.max(1, Math.floor(mn.clientHeight / RH) - 1), focus.c, e.shiftKey); break;
      case "PageUp": e.preventDefault(); select(focus.r - Math.max(1, Math.floor(mn.clientHeight / RH) - 1), focus.c, e.shiftKey); break;
      case "Delete": case "Backspace": e.preventDefault(); clearCells(); break;
      case "F2": e.preventDefault(); startEdit(); break;
      case "Escape": closePopup(); break;
      case " ":
        if (cellAt(anchor.r, anchor.c)?.t === "chk") { e.preventDefault(); toggleCheck(anchor.r, anchor.c); }
        else if (cellAt(anchor.r, anchor.c)?.t === "list") { e.preventDefault(); dropdownMenu(anchor.r, anchor.c); }
        else if (!mod && !proxyMode) { e.preventDefault(); startEdit(" "); }
        break;
      default:
        if (!proxyMode && !mod && !e.altKey && e.key.length === 1) {
          e.preventDefault();
          if (cellAt(anchor.r, anchor.c)?.t === "list") return;
          startEdit(e.key);
        }
    }
  }
  mn.addEventListener("keydown", gridKey);

  function toggleCheck(r, c) {
    mutate(() => setRaw(r, c, valueAt(r, c) === true ? "FALSE" : "TRUE"));
  }

  // ── pointer ──
  let drag = null;
  const cellFromEvent = (e) => {
    const box = mn.getBoundingClientRect();
    const x = e.clientX - box.left + mn.scrollLeft, y = e.clientY - box.top + mn.scrollTop;
    return { r: Math.min(model.rows - 1, at(ys, Math.max(0, y))), c: Math.min(model.cols - 1, at(xs, Math.max(0, x))), x, y };
  };
  function insertRefWhilePointing(r, c) {
    const before = ed.value.slice(0, ed.selectionStart);
    if (!(ed.value[0] === "=" && (before === "=" || /[-+*/^&=<>(,;:]$/.test(before)))) return false;
    ed.setRangeText(cellKey(c, r), ed.selectionStart, ed.selectionEnd, "end");
    fit();
    fi.value = ed.value;
    ed.focus();
    return true;
  }
  mn.addEventListener("pointerdown", (e) => {
    if (e.target === more) return;
    e.stopPropagation(); // the document-level "click outside closes the popup" must not close one this press opens
    closePopup();
    const hit = cellFromEvent(e);
    if (editing && !editing.bar) {
      if (insertRefWhilePointing(hit.r, hit.c)) {
        e.preventDefault();
        return;
      }
      endEdit(true);
    }
    if (e.target === fillH) {
      e.preventDefault();
      // With a finger the corner handle drags out a range (there is no Shift); with a mouse it fills.
      drag = e.pointerType === "touch" ? { kind: "extend", id: e.pointerId } : { kind: "fill", src: sel(), id: e.pointerId };
      mn.setPointerCapture(e.pointerId);
      return;
    }
    focusGrid();
    if (e.pointerType === "touch") {
      drag = { kind: "tap", x: e.clientX, y: e.clientY, cx: hit.x, r: hit.r, c: hit.c, wasActive: anchor.r === hit.r && anchor.c === hit.c && sel().r1 === sel().r2 && sel().c1 === sel().c2 };
      return;
    }
    e.preventDefault();
    const cell = cellAt(hit.r, hit.c);
    const inCell = (x0, x1) => hit.x >= x0 && hit.x <= x1;
    const tbl = tableAt(hit.r, hit.c);
    if (tbl && hit.r === tbl.r1 && inCell(xs[hit.c + 1] - 24, xs[hit.c + 1])) {
      select(hit.r, hit.c, false);
      tableMenu(tbl, hit.c);
      return;
    }
    if (cell?.t === "chk" && inCell(xs[hit.c] + (xs[hit.c + 1] - xs[hit.c]) / 2 - 12, xs[hit.c] + (xs[hit.c + 1] - xs[hit.c]) / 2 + 12)) {
      select(hit.r, hit.c, false);
      toggleCheck(hit.r, hit.c);
      return;
    }
    const wasActive = anchor.r === hit.r && anchor.c === hit.c && sel().r1 === sel().r2 && sel().c1 === sel().c2;
    select(hit.r, hit.c, e.shiftKey);
    if (cell?.t === "list" && (wasActive || inCell(xs[hit.c + 1] - 22, xs[hit.c + 1]))) {
      dropdownMenu(hit.r, hit.c);
      return;
    }
    drag = { kind: "select", id: e.pointerId };
    mn.setPointerCapture(e.pointerId);
  });
  mn.addEventListener("pointermove", (e) => {
    if (!drag || drag.kind === "tap") return;
    const hit = cellFromEvent(e);
    if (drag.kind === "select" || drag.kind === "extend") {
      if (hit.r !== focus.r || hit.c !== focus.c) select(hit.r, hit.c, true);
    } else if (drag.kind === "fill") {
      const s = drag.src;
      const dr = hit.r > s.r2 ? hit.r - s.r2 : hit.r < s.r1 ? hit.r - s.r1 : 0;
      const dc = hit.c > s.c2 ? hit.c - s.c2 : hit.c < s.c1 ? hit.c - s.c1 : 0;
      const dst = Math.abs(dr) >= Math.abs(dc) ? { ...s, r1: Math.min(s.r1, s.r1 + Math.min(dr, 0)), r2: Math.max(s.r2, s.r2 + Math.max(dr, 0)) } : { ...s, c1: Math.min(s.c1, s.c1 + Math.min(dc, 0)), c2: Math.max(s.c2, s.c2 + Math.max(dc, 0)) };
      drag.dst = dst;
      anchor = { r: dst.r1, c: dst.c1 };
      focus = { r: dst.r2, c: dst.c2 };
      paint();
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === "fill") {
      if (d.dst && (d.dst.r1 !== d.src.r1 || d.dst.r2 !== d.src.r2 || d.dst.c1 !== d.src.c1 || d.dst.c2 !== d.src.c2)) fill(d.src, d.dst);
      else { anchor = { r: d.src.r1, c: d.src.c1 }; focus = { r: d.src.r2, c: d.src.c2 }; paint(); }
    } else if (d.kind === "tap" && e.type === "pointerup" && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) {
      const cell = cellAt(d.r, d.c);
      const tbl = tableAt(d.r, d.c);
      select(d.r, d.c, false);
      if (tbl && d.r === tbl.r1 && d.cx >= xs[d.c + 1] - 30) return tableMenu(tbl, d.c);
      if (cell?.t === "chk") toggleCheck(d.r, d.c);
      else if (cell?.t === "list") { if (d.wasActive) dropdownMenu(d.r, d.c); }
      else if (d.wasActive) startEdit();
    }
  };
  mn.addEventListener("pointerup", endDrag);
  mn.addEventListener("pointercancel", () => (drag = null));
  mn.addEventListener("dblclick", (e) => {
    const hit = cellFromEvent(e);
    if (e.target === more || cellAt(hit.r, hit.c)?.t === "chk" || cellAt(hit.r, hit.c)?.t === "list") return;
    startEdit();
  });
  mn.addEventListener("scroll", () => {
    paint();
    if (editing) closePopup();
  });
  more.addEventListener("pointerdown", (e) => e.stopPropagation());
  more.addEventListener("click", () => {
    mutate(() => (model.rows = Math.min(MAX_ROWS, model.rows + 20)));
  });

  // Headers: click to select a whole column / row, drag a border to resize.
  function headerDown(axis, e) {
    e.preventDefault();
    e.stopPropagation();
    closePopup();
    const box = (axis === "c" ? chEl : rhEl).getBoundingClientRect();
    const pos = axis === "c" ? e.clientX - box.left + mn.scrollLeft : e.clientY - box.top + mn.scrollTop;
    const arr = axis === "c" ? xs : ys;
    const i = at(arr, pos);
    if (editing && !editing.bar) endEdit(true);
    focusGrid();
    const tol = e.pointerType === "touch" ? 12 : 5;
    const edge = arr[i + 1] - pos < tol ? i : pos - arr[i] < tol && i > 0 ? i - 1 : -1;
    if (edge >= 0) {
      undo.push(snapshot());
      redo = [];
      drag = { kind: "resize", axis, i: edge, start: pos, size: arr[edge + 1] - arr[edge], id: e.pointerId, moved: false };
    } else {
      const extend = e.shiftKey;
      if (axis === "c") {
        if (!extend) anchor = { r: 0, c: i };
        focus = { r: model.rows - 1, c: i };
      } else {
        if (!extend) anchor = { r: i, c: 0 };
        focus = { r: i, c: model.cols - 1 };
      }
      paint();
      syncBars();
      drag = { kind: "hdr", axis, id: e.pointerId };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function headerMove(axis, e) {
    const box = (axis === "c" ? chEl : rhEl).getBoundingClientRect();
    const pos = axis === "c" ? e.clientX - box.left + mn.scrollLeft : e.clientY - box.top + mn.scrollTop;
    if (!drag && e.pointerType !== "touch") {
      const arr = axis === "c" ? xs : ys;
      const i = at(arr, pos);
      const edge = arr[i + 1] - pos < 5 ? i : pos - arr[i] < 5 && i > 0 ? i - 1 : -1;
      e.currentTarget.style.cursor = edge >= 0 ? (axis === "c" ? "col-resize" : "row-resize") : "";
      showResizeBar(axis, edge);
      return;
    }
    if (!drag || drag.axis !== axis) return;
    if (drag.kind === "resize") {
      const size = Math.max(axis === "c" ? 24 : 16, Math.round(drag.size + pos - drag.start));
      if (axis === "c") model.w[colName(drag.i)] = size;
      else model.rh[drag.i + 1] = size;
      drag.moved = true;
      layout();
      paint();
    } else if (drag.kind === "hdr") {
      const i = at(axis === "c" ? xs : ys, Math.max(0, pos));
      focus = axis === "c" ? { r: model.rows - 1, c: i } : { r: i, c: model.cols - 1 };
      paint();
      syncBars();
    }
  }
  /** The dark bar on a header's border while you can drag it (like Sheets'). */
  function showResizeBar(axis, edge) {
    const bar = axis === "c" ? $("#rzc") : $("#rzr");
    if (edge < 0) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "block";
    if (axis === "c") Object.assign(bar.style, { left: 44 + xs[edge + 1] - mn.scrollLeft - 2 + "px", top: "4px", width: "4px", height: HEAD_H - 8 + "px" });
    else Object.assign(bar.style, { left: "10px", top: HEAD_H + ys[edge + 1] - mn.scrollTop - 2 + "px", width: "24px", height: "4px" });
  }
  const measure = document.createElement("canvas").getContext("2d");
  const textWidth = (cell, text) => {
    measure.font = `${cell?.i ? "italic " : ""}${cell?.b ? "bold " : ""}${cell?.fs || 13}px Arial`;
    return measure.measureText(text).width;
  };
  /** Double-click a header border: make the column as wide (or the row as tall) as its contents need. */
  function autoFit(axis, i) {
    mutate(() => {
      if (axis === "c") {
        let w = 0;
        for (let r = 0; r < model.rows; r++) {
          const cell = cellAt(r, i);
          const shown = display(valueAt(r, i), cell);
          if (shown !== "") w = Math.max(w, textWidth(cell, shown) + (cell?.t === "list" ? 44 : 16));
        }
        if (w) model.w[colName(i)] = Math.round(Math.min(480, Math.max(40, w)));
        else delete model.w[colName(i)];
      } else {
        let h = RH;
        for (let c = 0; c < model.cols; c++) {
          const cell = cellAt(i, c);
          const shown = display(valueAt(i, c), cell);
          const line = (Number(cell?.fs) || 13) * 1.6;
          if (shown !== "" && cell?.wr) h = Math.max(h, Math.ceil(textWidth(cell, shown) / Math.max(20, colW(c) - 10)) * line + 6);
          else h = Math.max(h, line + 4);
        }
        if (h > RH) model.rh[i + 1] = Math.round(h);
        else delete model.rh[i + 1];
      }
    });
  }
  const headerDouble = (axis, e) => {
    const box = (axis === "c" ? chEl : rhEl).getBoundingClientRect();
    const pos = axis === "c" ? e.clientX - box.left + mn.scrollLeft : e.clientY - box.top + mn.scrollTop;
    const arr = axis === "c" ? xs : ys;
    const i = at(arr, pos);
    const edge = arr[i + 1] - pos < 6 ? i : pos - arr[i] < 6 && i > 0 ? i - 1 : -1;
    if (edge >= 0) autoFit(axis, edge);
  };
  chEl.addEventListener("dblclick", (e) => headerDouble("c", e));
  rhEl.addEventListener("dblclick", (e) => headerDouble("r", e));
  chEl.addEventListener("pointerleave", () => showResizeBar("c", -1));
  rhEl.addEventListener("pointerleave", () => showResizeBar("r", -1));
  function headerUp() {
    if (drag?.kind === "resize") {
      if (!drag.moved) undo.pop();
      else scheduleSave();
    }
    drag = null;
  }
  chEl.addEventListener("pointerdown", (e) => headerDown("c", e));
  chEl.addEventListener("pointermove", (e) => headerMove("c", e));
  chEl.addEventListener("pointerup", headerUp);
  rhEl.addEventListener("pointerdown", (e) => headerDown("r", e));
  rhEl.addEventListener("pointermove", (e) => headerMove("r", e));
  rhEl.addEventListener("pointerup", headerUp);
  $("#corner").addEventListener("click", () => {
    anchor = { r: 0, c: 0 };
    focus = { r: model.rows - 1, c: model.cols - 1 };
    paint();
    syncBars();
    focusGrid();
  });

  // The note's frame height: drag the grip to make the sheet taller or shorter.
  $("#grip").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { kind: "grip", off: window.innerHeight - e.clientY };
  });
  $("#grip").addEventListener("pointermove", (e) => {
    if (drag?.kind !== "grip") return;
    model.h = Math.max(160, Math.min(1200, e.clientY + drag.off));
    block.resize(model.h);
  });
  $("#grip").addEventListener("pointerup", () => {
    if (drag?.kind === "grip") {
      drag = null;
      scheduleSave();
    }
  });

  window.addEventListener("resize", paint);
  document.addEventListener("pointerdown", (e) => {
    if (popup && !popup.contains(e.target)) closePopup();
  });

  layout();
  block.resize(model.page ? "fill" : model.h);
  applyTheme();
  if (model.page) {
    $("#grip").style.display = "none"; // the page decides the height
    app.classList.add("page");
  }
  paint();
  syncBars();

  return {
    /** The note's text changed under us (undo in the note, sync): take it, unless it is what we just wrote. */
    update(text) {
      if (text === lastSaved) return;
      try {
        model = parseSheet(text);
      } catch {
        return; // half-typed text: keep the grid we have
      }
      lastSaved = text;
      undo = [];
      redo = [];
      block.resize(model.page ? "fill" : model.h);
      refresh();
    },
  };
}

/**
 * A sheet whose text can't be read is never replaced by an empty grid (the next edit would save over the
 * user's data): show why, and let them open it as text to fix it.
 */
function mountSheet(root, source, block) {
  let model;
  try {
    model = parseSheet(source);
  } catch (e) {
    root.innerHTML = `<div style="margin:0;padding:12px 14px;border:1px solid #d93025;border-radius:8px;font:13px Arial,sans-serif;color:var(--text,#202124);background:var(--bg,#fff)">
      <b>This spreadsheet's text can't be read</b> <span style="opacity:.7">(${esc(e instanceof Error ? e.message : String(e))})</span><br>
      <button style="margin-top:8px;padding:3px 10px;cursor:pointer">Show as text</button></div>`;
    root.querySelector("button").addEventListener("click", () => block.edit());
    block.resize(96);
    return {
      update(text) {
        try {
          parseSheet(text);
        } catch {
          return undefined;
        }
        root.innerHTML = "";
        return mountSheet(root, text, block);
      },
    };
  }
  return startGrid(root, model, source, block);
}

if (typeof granite !== "undefined") {
  granite.blocks.register("sheet", (el, source, block) => {
    let inner = mountSheet(el, source, block);
    return {
      update(text) {
        inner = inner.update(text) || inner;
      },
    };
  });

  granite.commands.add({
    id: "page",
    name: "Turn this page into a sheet",
    page: true, // also in the ⋯ menu at the top right of a note
    run: async () => {
      const text = await granite.editor.getText();
      const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
      const front = fm ? fm[0] : "";
      const body = text.slice(front.length);
      if (/^```sheet\b/m.test(body)) return granite.notice("This page already has a sheet");
      // A new note only holds its "# Title" line; that and blank lines are replaced. Real text is kept, below the sheet.
      const blank = body.replace(/^\s*#[^\n]*\n?/, "").trim() === "";
      const sheet = "```sheet\n" + serializeSheet({ ...emptySheet(), cols: 26, rows: 100, page: 1 }) + "\n```\n";
      await granite.editor.setText(front + (front && !front.endsWith("\n") ? "\n" : "") + sheet + (blank ? "" : "\n" + body.replace(/^\n+/, "")));
      if (!blank) granite.notice("The sheet is at the top; your text is below it");
    },
  });

  granite.input.addItem({
    id: "sheet",
    name: "Spreadsheet",
    description: "A grid with formulas, like Excel",
    insert: () => "```sheet\n" + serializeSheet(emptySheet()) + "\n```",
  });

  granite.commands.add({
    id: "insert",
    name: "Insert a spreadsheet",
    run: async () => {
      await granite.editor.replaceSelection("\n```sheet\n" + serializeSheet(emptySheet()) + "\n```\n");
    },
  });
}
