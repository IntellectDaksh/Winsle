// Palette maths: a small recursive-descent calculator (no eval) and offline
// unit conversions.

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Result as a display string, or null when `src` isn't a calculation. */
export function evaluate(src: string): string | null {
  const s = src.replace(/,/g, "").replace(/×/g, "*").replace(/÷/g, "/").trim().toLowerCase();
  // Needs an operator or a function: a bare number is a timer, not a sum.
  // Limit input length and recursion depth to prevent stack overflow / CPU exhaustion DoS
  if (!s || s.length > 512 || !/[+\-*/^%()]|sqrt|abs|round|floor|ceil|sin|cos|tan|log|ln/.test(s) || /^\d+\s*m(in)?$/.test(s)) return null;
  let i = 0;
  let depth = 0;
  const MAX_DEPTH = 32;

  const peek = () => s[i];
  const ws = () => { while (s[i] === " ") i++; };
  const fail = (): never => { throw new Error("bad"); };
  const enter = () => { if (++depth > MAX_DEPTH) fail(); };
  const leave = () => { depth--; };

  function primary(): number {
    enter();
    try {
      ws();
      if (peek() === "(") {
        i++;
        const v = expr();
        ws();
        if (peek() !== ")") fail();
        i++;
        return v;
      }
      if (peek() === "-") { i++; return -primary(); }
      if (peek() === "+") { i++; return primary(); }
      const num = /^\d*\.?\d+(e[+-]?\d+)?/.exec(s.slice(i));
      if (num) { i += num[0].length; return parseFloat(num[0]); }
      const id = /^[a-z]+/.exec(s.slice(i));
      if (id) {
        i += id[0].length;
        if (id[0] in CONSTS) return CONSTS[id[0]];
        const f = FUNCS[id[0]];
        if (!f) fail();
        return f(primary());
      }
      return fail();
    } finally {
      leave();
    }
  }
  function power(): number {
    const b = primary();
    ws();
    if (peek() === "^") { i++; return b ** power(); }
    return b;
  }
  function term(): number {
    let v = power();
    for (;;) {
      ws();
      const c = peek();
      if (c === "*") { i++; v *= power(); }
      else if (c === "/") { i++; v /= power(); }
      else if (c === "%") { i++; v %= power(); }
      else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      ws();
      const c = peek();
      if (c === "+") { i++; v += term(); }
      else if (c === "-") { i++; v -= term(); }
      else return v;
    }
  }
  try {
    const v = expr();
    ws();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return String(Math.round(v * 1e10) / 1e10);
  } catch {
    return null;
  }
}

// Linear units: factor to a base unit per dimension.
const UNITS: Record<string, [string, number]> = {
  mm: ["len", 0.001], cm: ["len", 0.01], m: ["len", 1], km: ["len", 1000],
  in: ["len", 0.0254], ft: ["len", 0.3048], yd: ["len", 0.9144], mi: ["len", 1609.344],
  g: ["mass", 0.001], kg: ["mass", 1], lb: ["mass", 0.45359237], oz: ["mass", 0.028349523],
  ml: ["vol", 0.001], l: ["vol", 1], gal: ["vol", 3.785411784],
  kb: ["data", 1e3], mb: ["data", 1e6], gb: ["data", 1e9], tb: ["data", 1e12],
  kib: ["data", 1024], mib: ["data", 1024 ** 2], gib: ["data", 1024 ** 3], tib: ["data", 1024 ** 4],
  s: ["time", 1], min: ["time", 60], h: ["time", 3600], day: ["time", 86400],
  kmh: ["speed", 1 / 3.6], mph: ["speed", 0.44704],
};
const DEFAULT_TO: Record<string, string> = {
  km: "mi", mi: "km", m: "ft", ft: "m", cm: "in", in: "cm", kg: "lb", lb: "kg", g: "oz", oz: "g",
  l: "gal", gal: "l", kmh: "mph", mph: "kmh", c: "f", f: "c", k: "c", gb: "mb", mb: "gb",
  kib: "mib", mib: "gib", gib: "mib", tib: "gib",
};

function fmt(n: number): string {
  return Math.abs(n) >= 100 ? n.toFixed(1).replace(/\.0$/, "") : String(Math.round(n * 1000) / 1000);
}

/** "5 km to mi" → "3.107 mi"; "30 c" → "86 °F". Null when not a conversion. */
export function convert(src: string): string | null {
  const m = /^(-?[\d.]+)\s*([a-z°]+)(?:\s+(?:to|in)\s+([a-z°]+))?$/i.exec(src.trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  const from = m[2].toLowerCase().replace("°", "");
  const to = (m[3]?.toLowerCase().replace("°", "")) ?? DEFAULT_TO[from];
  if (!Number.isFinite(v) || !to) return null;
  if (from === "c" && to === "f") return `${fmt(v * 9 / 5 + 32)} °F`;
  if (from === "f" && to === "c") return `${fmt((v - 32) * 5 / 9)} °C`;
  if (from === "c" && to === "k") return `${fmt(v + 273.15)} K`;
  if (from === "k" && to === "c") return `${fmt(v - 273.15)} °C`;
  if (from === "f" && to === "k") return `${fmt((v - 32) * 5 / 9 + 273.15)} K`;
  if (from === "k" && to === "f") return `${fmt((v - 273.15) * 9 / 5 + 32)} °F`;
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a[0] !== b[0]) return null;
  return `${fmt((v * a[1]) / b[1])} ${to}`;
}
