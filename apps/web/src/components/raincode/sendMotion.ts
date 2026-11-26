// RainCode send motion: what plays between pressing send and the message sitting in the chat.
// Ported from docs/raincode/drop-preview.html. It lives outside React on purpose: T3 swaps the draft
// screen for the chat the moment you send, so the words in flight, the falling box and the dust sit on
// fixed overlays, and hand off to T3's real bubble and docked composer by selector.
import { getClientSettings } from "~/hooks/useSettings";

export const SIGNAL = "#7c6eff";
const INK = "#0f0e12";
const NIGHT = "#e9e7e2";
export const inkColor = () => (document.documentElement.classList.contains("dark") ? NIGHT : INK);
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const EDITOR = '[data-chat-composer-form] [data-testid="composer-editor"]';
const SHELL = '[data-slot="composer-shell"]';
const GLIDE_EASE = "cubic-bezier(.65,0,.35,1)";
const px = (n: number) => `${n}px`;

type TextCopy = { el: HTMLDivElement; spans: HTMLSpanElement[] };
type Send = {
  id: string;
  first: boolean;
  theme: "dots" | "plain";
  arrival: "rise" | "condense";
  at: number;
  text: string;
  editor: HTMLElement;
  shell: DOMRect | null;
  fly: TextCopy | null;
  hide: HTMLStyleElement;
  timers: number[];
  done: boolean;
  // T3 can swap the bubble's element (its optimistic row for the server's) mid-send; this follows it.
  bubble: HTMLElement | null;
  onSwap: ((el: HTMLElement) => void) | null;
  watch: MutationObserver | null;
};
let current: Send | null = null;

const later = (s: Send, ms: number, fn: () => void) => {
  s.timers.push(window.setTimeout(fn, Math.max(0, ms - (performance.now() - s.at))));
};

function typeOf(el: Element) {
  return getComputedStyle(el.querySelector("p") ?? el);
}

function charSpans(host: HTMLElement, text: string) {
  return Array.from(text).map((ch) => {
    const sp = document.createElement("span");
    sp.textContent = ch;
    host.append(sp);
    return sp;
  });
}

/** A copy of some text laid over `from`'s content box in `from`'s type: fixed on the page, or inside
 *  `host` so it moves with it. */
function textCopy(from: HTMLElement, text: string, clip: boolean, host?: HTMLElement): TextCopy {
  const r = from.getBoundingClientRect(),
    box = getComputedStyle(from),
    type = typeOf(from);
  const at = host?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const el = document.createElement("div");
  const pl = parseFloat(box.paddingLeft),
    pt = parseFloat(box.paddingTop);
  Object.assign(el.style, {
    position: host ? "absolute" : "fixed",
    left: px(r.left + pl - at.left),
    top: px(r.top + pt - at.top),
    width: px(from.clientWidth - pl - parseFloat(box.paddingRight)),
    margin: "0",
    font: type.font,
    letterSpacing: type.letterSpacing,
    color: type.color,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    pointerEvents: "none",
    transformOrigin: "0 0",
    zIndex: "60",
  });
  if (clip) {
    el.style.height = px(from.clientHeight - pt - parseFloat(box.paddingBottom));
    el.style.overflow = "hidden";
  }
  el.setAttribute("aria-hidden", "true");
  const spans = charSpans(el, text);
  (host ?? document.body).append(el);
  if (clip) el.scrollTop = from.scrollTop;
  return { el, spans };
}

/** Called by the composer as a message leaves it, before T3 clears the box or swaps the screen. */
export function captureSend(id: string, first: boolean) {
  if (typeof document === "undefined" || reducedMotion()) return;
  const { raincodeTheme: theme, raincodeArrival: arrival } = getClientSettings();
  if (!first && theme === "dots") return;
  const editor = document.querySelector<HTMLElement>(EDITOR);
  const text = editor?.innerText.replace(/\n+$/, "") ?? "";
  if (!editor || !text.trim()) return;
  finishSend();
  const hide = document.createElement("style");
  // A rule, not an inline style, so it holds however T3 re-renders the row.
  hide.textContent = `[data-message-id="${CSS.escape(id)}"] [data-user-message-bubble]{opacity:0}`;
  document.head.append(hide);
  const s: Send = {
    id,
    first,
    theme,
    arrival,
    at: performance.now(),
    text,
    editor,
    shell: editor.closest(SHELL)?.getBoundingClientRect() ?? null,
    fly: null,
    hide,
    timers: [],
    done: false,
    bubble: null,
    onSwap: null,
    watch: null,
  };
  // The copy stands in for the words while T3 empties the box underneath.
  if (!first || theme === "plain" || arrival === "rise") s.fly = textCopy(editor, text, !first);
  editor.style.opacity = "0";
  if (first) later(s, theme === "plain" ? 600 : 400, () => (editor.style.opacity = ""));
  current = s;
  waitForBubble(s);
}

function finishSend() {
  const s = current;
  if (!s || s.done) return;
  s.done = true;
  s.timers.forEach(clearTimeout);
  s.watch?.disconnect();
  s.fly?.el.remove();
  s.hide.remove();
  s.editor.style.opacity = "";
  document.querySelectorAll("[data-raincode-copy]").forEach((el) => el.remove());
  if (current === s) current = null;
}

function waitForBubble(s: Send) {
  const sel = `[data-message-id="${CSS.escape(s.id)}"] [data-user-message-bubble]`;
  const check = () => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el || el === s.bubble || s.done) return;
    const first = !s.bubble;
    s.bubble = el;
    // Right away, before it paints; later swaps just carry the motion over to the new element.
    if (first) reveal(s, el);
    else s.onSwap?.(el);
  };
  s.watch = new MutationObserver(check);
  s.watch.observe(document.body, { childList: true, subtree: true });
  check();
  later(s, 3000, () => {
    if (!s.bubble) finishSend();
  });
}

const bodyOf = (bubble: HTMLElement) =>
  bubble.querySelector<HTMLElement>("[data-user-message-body]") ?? bubble;

function reveal(s: Send, bubble: HTMLElement) {
  if (!s.first) return evaporate(s, bubble);
  const fadeIn = (at: number) =>
    later(s, at, () => {
      s.hide.remove();
      s.bubble?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
      later(s, at + 240, finishSend);
    });
  if (s.theme === "dots" && s.arrival === "condense") {
    // It comes into focus where it lives, like fog on glass.
    return later(s, 650, () => {
      s.hide.remove();
      s.bubble?.animate(
        [
          { opacity: 0, filter: "blur(8px)", transform: "translateY(4px) scale(.985)" },
          { opacity: 1, filter: "blur(0)", transform: "none" },
        ],
        { duration: 560, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
      later(s, 1250, finishSend);
    });
  }
  const fly = s.fly!.el;
  // Where the words land, measured as they take off: T3 may still be settling the new turn before that.
  const landing = () => {
    const body = bodyOf(s.bubble ?? bubble),
      to = body.getBoundingClientRect(),
      from = fly.getBoundingClientRect();
    const scale =
      parseFloat(typeOf(body).fontSize) / parseFloat(getComputedStyle(fly).fontSize) || 1;
    // Wrap the copy like the bubble will, so the words land on their own lines.
    fly.style.width = px((to.width + 6) / scale);
    return `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`;
  };
  if (s.theme === "dots") {
    // Rise: the words leave the box and float up to where the message lives, passing the sinking box.
    const AT = 140,
      RISE = 760;
    later(s, AT, () =>
      fly.animate([{ transform: "none" }, { transform: landing() }], {
        duration: RISE,
        easing: GLIDE_EASE,
        fill: "forwards",
      }),
    );
    return fadeIn(AT + RISE - 60);
  }
  // Plain: the words lift off the surface as the box breaks, hover a beat, then rise whole.
  const GO = 520,
    RISE = 1400;
  const lift = document.documentElement.classList.contains("dark") ? 0.35 : 0.16;
  const up = {
    transform: "translate(0,-12px) scale(1.02)",
    textShadow: `0 8px 14px rgba(0,0,0,${lift})`,
  };
  fly.animate(
    [
      { offset: 0, transform: "none", textShadow: "0 0 0 transparent" },
      {
        offset: 220 / GO,
        transform: "translate(0,-10px) scale(1.02)",
        textShadow: up.textShadow,
        easing: "cubic-bezier(.2,.7,.2,1)",
      },
      { offset: 1, ...up },
    ],
    { duration: GO, fill: "forwards" },
  );
  later(s, GO, () => {
    // Measured from the resting spot, then the lift is folded into the first frame.
    fly.getAnimations().forEach((a) => a.cancel());
    const end = landing();
    fly.animate([up, { transform: end, textShadow: "0 0 0 transparent" }], {
      duration: RISE,
      easing: GLIDE_EASE,
      fill: "forwards",
    });
  });
  fadeIn(GO + RISE - 60);
}

// The dock: T3's FLIP of the composer from the centre to the bottom, on RainCode's timing

const BREAK = 180,
  LOOSE = 260,
  SPREAD = 2300,
  FALL = 620,
  FALL_VAR = 260,
  SOAK = 420,
  SPLASH = 200;
const DOTS_CLEAR_MS = 4200;

export const raincodeDockPending = () => !!current?.first && !current.done;

/** Keyframes for the first send's composer move, or null to keep T3's. `dx`/`dy` go from new to old. */
export function raincodeDock(group: HTMLElement, dx: number, dy: number) {
  const s = current;
  if (!s?.first || s.done) return null;
  const at = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0)`;
  const home = at(0, 0),
    dip = at(0, 2),
    from = at(dx, dy);
  if (s.theme === "dots") {
    // Hold while the drops fall, glide down on Tenon's curve, then settle like a drop landing (2px dip).
    const HOLD = 500,
      GLIDE = 800,
      T = HOLD + GLIDE + 320;
    return {
      duration: T,
      // The field keeps clearing after the box lands; T3 holds the draft screen until this is done.
      hold: DOTS_CLEAR_MS,
      keyframes: [
        { offset: 0, transform: from },
        { offset: HOLD / T, transform: from, easing: GLIDE_EASE },
        { offset: (HOLD + GLIDE) / T, transform: home, easing: "cubic-bezier(.3,0,.5,1)" },
        { offset: (HOLD + GLIDE + 110) / T, transform: dip, easing: "cubic-bezier(.4,0,.2,1)" },
        { offset: 1, transform: home },
      ],
    };
  }
  const shell = group.querySelector<HTMLElement>(SHELL);
  if (!shell || !s.shell) return null;
  const end = BREAK + SPREAD + LOOSE + FALL + FALL_VAR + SOAK,
    T = end + 340;
  rebuild(s.shell, shell, group.querySelector<HTMLElement>("[data-raincode-keys]"), -dy);
  // The box is gone (it's dots now) the moment it moves, so it simply jumps to its new home and soaks back in.
  return {
    duration: T,
    hold: T,
    keyframes: [
      { offset: 0, transform: from },
      { offset: (100 + BREAK) / T, transform: from },
      { offset: (110 + BREAK) / T, transform: home },
      { offset: end / T, transform: home, easing: "cubic-bezier(.3,0,.5,1)" },
      { offset: (end + 120) / T, transform: dip, easing: "cubic-bezier(.4,0,.2,1)" },
      { offset: 1, transform: home },
    ],
  };
}

/** The dots field asks this as the draft screen goes: where the box was, if it should clear from a send. */
export function dotsSendStarted(): DOMRect | null {
  const s = current;
  return s?.first && s.theme === "dots" && !s.done ? s.shell : null;
}

// The overlay canvas: falling box and dust. It exists only while something is moving.

type Mote = {
  x: number;
  y: number;
  at: number;
  vx: number;
  vy: number;
  life: number;
  rev?: boolean;
  follow?: Follow;
};
// Dust bound for a bubble moves with it while T3's timeline settles.
type Follow = { el: HTMLElement; x0: number; y0: number; dx: number; dy: number; seen: number };
type Shard = {
  x: number;
  y: number;
  edge: boolean;
  visible: boolean;
  ci: number;
  cj: number;
  delay: number;
  fall: number;
};
type Shards = {
  at: number;
  list: Shard[];
  to: number;
  end: number;
  img: ImageData;
  mask: CanvasRenderingContext2D;
  shell: HTMLElement;
  keys: HTMLElement | null;
};
const fx = { motes: [] as Mote[], shards: null as Shards | null };
let cv: HTMLCanvasElement | null = null;
let raf = 0;

const kick = () => {
  if (!raf) raf = requestAnimationFrame(frame);
};

function frame(now: number) {
  raf = 0;
  if (!cv) {
    cv = document.createElement("canvas");
    cv.setAttribute("aria-hidden", "true");
    Object.assign(cv.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "61",
    });
    document.body.append(cv);
  }
  const W = innerWidth,
    H = innerHeight,
    dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const g = cv.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const ink = inkColor();
  drawShards(now, g, ink);
  drawMotes(now, g, ink);
  if (fx.motes.length || fx.shards) raf = requestAnimationFrame(frame);
  else {
    cv.remove();
    cv = null;
  }
}

const smooth = (v: number) => {
  v = Math.min(1, Math.max(0, v));
  return v * v * (3 - 2 * v);
};
const setMask = (el: HTMLElement, v: string) => {
  el.style.maskImage = v;
  el.style.webkitMaskImage = v;
  el.style.maskSize = el.style.webkitMaskSize = v ? "100% 100%" : "";
};

// The box's surface turns to dots: an interior grid plus dots along the real rounded edge. They let go
// bottom rows first, loosely random within a row, fall under gravity and the box soaks back in, spot by
// spot, right where each drop lands.
function rebuild(fb: DOMRect, shell: HTMLElement, keys: HTMLElement | null, to: number) {
  const S = 7,
    R = parseFloat(getComputedStyle(shell).borderTopLeftRadius) || 22,
    list: Shard[] = [];
  const cols = Math.floor((fb.width - 5) / S) + 1,
    rows = Math.floor((fb.height - 5) / S) + 1;
  const mx = (fb.width - (cols - 1) * S) / 2,
    my = (fb.height - (rows - 1) * S) / 2;
  const M = 3,
    r = R - M,
    L = fb.left + M,
    Tp = fb.top + M,
    Rt = fb.right - M,
    Bt = fb.bottom - M;
  // signed distance to the rounded edge (negative inside)
  const sd = (x: number, y: number) => {
    const qx = Math.abs(x - (L + Rt) / 2) - ((Rt - L) / 2 - r),
      qy = Math.abs(y - (Tp + Bt) / 2) - ((Bt - Tp) / 2 - r);
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  };
  const timing = (y: number) => {
    const v = (Bt - y) / (Bt - Tp); // 0 at the bottom
    return {
      delay: BREAK + Math.min(1, 0.62 * v + 0.38 * Math.random()) * SPREAD,
      fall: FALL + Math.random() * FALL_VAR,
    };
  };
  for (let cj = 0; cj < rows; cj++)
    for (let ci = 0; ci < cols; ci++) {
      const x = fb.left + mx + ci * S,
        y = fb.top + my + cj * S;
      list.push({ x, y, edge: false, visible: sd(x, y) < -4, ci, cj, ...timing(y) });
    }
  const sw = Rt - L - 2 * r,
    sh = Bt - Tp - 2 * r,
    arc = (Math.PI / 2) * r;
  const per = 2 * (sw + sh) + 4 * arc,
    n = Math.round(per / 6);
  const segs: Array<[number, (u: number) => [number, number]]> = [
    [sw, (u) => [L + r + u, Tp]],
    [
      arc,
      (u) => {
        const a = -Math.PI / 2 + u / r;
        return [Rt - r + r * Math.cos(a), Tp + r + r * Math.sin(a)];
      },
    ],
    [sh, (u) => [Rt, Tp + r + u]],
    [
      arc,
      (u) => {
        const a = u / r;
        return [Rt - r + r * Math.cos(a), Bt - r + r * Math.sin(a)];
      },
    ],
    [sw, (u) => [Rt - r - u, Bt]],
    [
      arc,
      (u) => {
        const a = Math.PI / 2 + u / r;
        return [L + r + r * Math.cos(a), Bt - r + r * Math.sin(a)];
      },
    ],
    [sh, (u) => [L, Bt - r - u]],
    [
      arc,
      (u) => {
        const a = Math.PI + u / r;
        return [L + r + r * Math.cos(a), Tp + r + r * Math.sin(a)];
      },
    ],
  ];
  const along = (t: number): [number, number] => {
    for (const [len, fn] of segs) {
      if (t <= len) return fn(t);
      t -= len;
    }
    return segs[0]![1](0);
  };
  for (let i = 0; i < n; i++) {
    const [x, y] = along((i / n) * per);
    list.push({ x, y, edge: true, visible: true, ci: -1, cj: -1, ...timing(y) });
  }
  const maskCv = document.createElement("canvas");
  maskCv.width = cols;
  maskCv.height = rows;
  const mask = maskCv.getContext("2d")!;
  if (keys) keys.style.opacity = "0";
  fx.shards = {
    at: performance.now(),
    list,
    to,
    end: BREAK + SPREAD + LOOSE + FALL + FALL_VAR + SOAK,
    img: mask.createImageData(cols, rows),
    mask,
    shell,
    keys,
  };
  kick();
}

function drawShards(now: number, g: CanvasRenderingContext2D, ink: string) {
  const s = fx.shards;
  if (!s) return;
  const age = now - s.at;
  if (age > s.end + 40) {
    fx.shards = null;
    s.shell.style.opacity = "";
    setMask(s.shell, "");
    if (s.keys) {
      s.keys.style.opacity = "";
      s.keys.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    }
    return;
  }
  const appear = smooth((age - 100) / BREAK);
  const px = s.img.data;
  g.strokeStyle = ink;
  g.lineCap = "round";
  for (const d of s.list) {
    let y = d.y,
      streak = 0,
      soak = 0,
      bead = 0,
      splash = -1;
    const k = age - d.delay;
    if (k > 0) {
      // A drop, not a tween: it beads up, lets go, falls under gravity (no ease-out), streak growing with
      // speed, then flattens into a tiny splash while the box soaks back in around that spot.
      bead = smooth(k / LOOSE) * (1 - smooth((k - LOOSE) / 80));
      const f = Math.min(1, Math.max(0, (k - LOOSE) / d.fall));
      y += s.to * f * f;
      streak = f > 0 && f < 1 ? 3 + 16 * f : 0;
      const hit = k - LOOSE - d.fall;
      if (hit >= 0 && hit < SPLASH) splash = hit / SPLASH;
      soak = smooth(hit / SOAK);
    }
    if (d.ci >= 0) px[(d.cj * s.img.width + d.ci) * 4 + 3] = Math.round(255 * soak);
    const base = d.visible ? (d.edge ? 0.6 : 0.3) * appear : 0;
    if (splash >= 0 && base) {
      const w = 1.5 + 5 * (1 - (1 - splash) ** 2);
      g.globalAlpha = Math.min(1, base * 1.4) * (1 - splash);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(d.x - w, y);
      g.lineTo(d.x + w, y);
      g.stroke();
    }
    const a = base * (1 - soak) * (splash >= 0 ? 1 - splash : 1);
    if (a < 0.01) continue;
    g.globalAlpha = a;
    g.lineWidth = (d.edge ? 2.4 : 2) * (1 + 0.5 * bead);
    g.beginPath();
    g.moveTo(d.x, y - streak);
    g.lineTo(d.x, y + 0.01);
    g.stroke();
  }
  g.globalAlpha = 1;
  if (age < 100 + BREAK) s.shell.style.opacity = String(1 - appear);
  else {
    // One mask pixel per dot, stretched over the box; the browser's smoothing turns each into a soft patch.
    s.shell.style.opacity = "";
    s.mask.putImageData(s.img, 0, 0);
    setMask(s.shell, `url(${s.mask.canvas.toDataURL()})`);
  }
}

function drawMotes(now: number, g: CanvasRenderingContext2D, ink: string) {
  fx.motes = fx.motes.filter((m) => now < m.at + m.life);
  g.fillStyle = ink;
  for (const m of fx.motes) {
    if (now < m.at) continue;
    let ox = 0,
      oy = 0;
    const f = m.follow;
    if (f) {
      if (f.seen !== now) {
        const r = f.el.getBoundingClientRect();
        f.dx = r.left - f.x0;
        f.dy = r.top - f.y0;
        f.seen = now;
      }
      ox = f.dx;
      oy = f.dy;
    }
    // rev: starts below the letter and rises into it, slowing as it lands
    const t = m.rev ? m.life - (now - m.at) : now - m.at,
      k = t / m.life;
    g.globalAlpha = 0.75 * (1 - k) ** 1.4;
    g.beginPath();
    g.arc(
      ox + m.x + m.vx * t,
      oy + m.y + m.vy * t + (m.rev ? 0.00004 : -0.00004) * t * t,
      1.1 * (1 - 0.5 * k),
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  g.globalAlpha = 1;
}

// Plain, every send after the first: the words evaporate and the bubble forms from the dust

// A line takes a bit longer to sweep than the gap to the next, so each picks up before the last finishes.
const LINE = 520,
  MELT = 340,
  ARRIVE = 1350,
  SWEEP_X = 620;
// Long messages: a send always finishes in about the same time, only what you can see gets the effect,
// and the dust has a cap. Short messages keep the natural pace.
const EVAP_BUDGET = 1300,
  FORM_BUDGET = 1300,
  FORM_LINES = 5,
  MOTE_CAP = 360;

function lineOrder(spans: HTMLSpanElement[]) {
  const top = spans.map((sp) => Math.round(sp.getBoundingClientRect().top));
  const tops = [...new Set(top)].sort((a, b) => a - b);
  return top.map((t) => tops.indexOf(t));
}

function evaporate(s: Send, bubble: HTMLElement) {
  const now = s.at,
    src = s.fly!,
    a = src.spans;
  const from = src.el.getBoundingClientRect();
  const body = bodyOf(bubble),
    text = body.innerText.replace(/\n+$/, "");
  // The bubble's words, as a copy over its own text, so each letter can come in on its own.
  const dst = textCopy(body, text, true, bubble);
  dst.el.dataset.raincodeCopy = "";
  const b = dst.spans;
  b.forEach((sp) => (sp.style.opacity = "0"));
  // Swap the rule: the bubble shows (its edge is clipped below) but its own words wait under the copy.
  s.hide.textContent = `[data-message-id="${CSS.escape(s.id)}"] [data-user-message-body]{opacity:0}`;
  const bb = bubble.getBoundingClientRect(),
    db = dst.el.getBoundingClientRect();
  const follow: Follow = { el: bubble, x0: bb.left, y0: bb.top, dx: 0, dy: 0, seen: 0 };
  let edge: (() => void) | null = null;
  s.onSwap = (el) => {
    follow.el = el;
    el.append(dst.el);
    edge?.();
  };
  const seen = a.map((sp) => {
    const r = sp.getBoundingClientRect();
    return r.bottom > from.top + 2 && r.top < from.bottom - 2;
  });
  const la = lineOrder(a),
    lb0 = lineOrder(b);
  // T3 scrolls a new turn to the top, so the bubble's first lines are the ones on screen: dust builds those.
  const lb = lb0;
  const seenLines = la.filter((_, i) => seen[i]);
  const firstSeen = Math.min(...seenLines),
    lastSeen = Math.max(...seenLines);
  const evapLines = lastSeen - firstSeen + 1,
    formLines = Math.min(FORM_LINES, Math.max(0, ...lb) + 1);
  const anim = (x: number) => x < FORM_LINES;
  const ks = Math.min(1, EVAP_BUDGET / ((evapLines - 1) * LINE + SWEEP_X));
  const kf = Math.min(1, FORM_BUDGET / ((formLines - 1) * LINE + SWEEP_X));
  const nSeen = seen.filter(Boolean).length,
    nForm = lb.filter(anim).length;
  const perA = Math.max(1, Math.min(3, Math.floor(MOTE_CAP / Math.max(1, nSeen))));
  const perB = Math.max(1, Math.min(3, Math.floor(MOTE_CAP / Math.max(1, nForm))));
  let last = 0,
    formEnd = 0;
  const showAt: number[] = [];
  a.forEach((sp, i) => {
    if (!seen[i]) return ((sp.style.opacity = "0"), undefined);
    const r = sp.getBoundingClientRect();
    const t =
      ((la[i]! - firstSeen) * LINE + ((r.left - from.left) / from.width) * SWEEP_X) * ks +
      Math.random() * 90;
    sp.animate(
      [
        { opacity: 1, filter: "blur(0)" },
        { opacity: 0, filter: "blur(2px)" },
      ],
      { duration: MELT, delay: t, fill: "forwards" },
    );
    if (sp.textContent?.trim())
      for (let m = 0; m < perA; m++)
        fx.motes.push({
          x: r.left + Math.random() * r.width,
          y: r.top + r.height * (0.25 + 0.6 * Math.random()),
          at: now + t + Math.random() * 160,
          vx: (Math.random() - 0.5) * 0.06,
          vy: -(0.05 + Math.random() * 0.07),
          life: 1100 + Math.random() * 600,
        });
    last = Math.max(last, t + MELT);
  });
  b.forEach((sp, i) => {
    if (!anim(lb[i]!)) return;
    const br = sp.getBoundingClientRect();
    const show = (lb[i]! * LINE + ((br.left - db.left) / db.width) * SWEEP_X) * kf + ARRIVE;
    showAt[i] = show;
    if (sp.textContent?.trim())
      for (let m = 0; m < perB; m++) {
        const life = 900 + Math.random() * 450;
        fx.motes.push({
          rev: true,
          follow,
          x: br.left + Math.random() * br.width,
          y: br.top + br.height * (0.25 + 0.6 * Math.random()),
          at: now + show + MELT * 0.6 - life - Math.random() * 120,
          vx: (Math.random() - 0.5) * 0.06,
          vy: 0.05 + Math.random() * 0.07,
          life,
        });
      }
    sp.animate(
      [
        { opacity: 0, filter: "blur(2px)" },
        { opacity: 1, filter: "blur(0)" },
      ],
      {
        duration: MELT,
        delay: show - (performance.now() - now),
        easing: "cubic-bezier(0,0,.6,1)",
        fill: "forwards",
      },
    );
    formEnd = Math.max(formEnd, show + MELT);
  });
  // Past the dust-built lines, the rest keep flowing down in turn (quicker, no dust).
  const below = (i: number) => !anim(lb[i]!);
  const bulk = lb0.filter((_, i) => below(i));
  const firstBulk = Math.min(Infinity, ...bulk);
  const nBulk = Math.max(0, ...bulk.map((x) => x - firstBulk + 1));
  const STEP = nBulk ? Math.min(110, 600 / nBulk) : 0;
  b.forEach((sp, i) => {
    if (anim(lb[i]!)) return;
    const r = sp.getBoundingClientRect();
    const at = formEnd - 180 + (lb0[i]! - firstBulk) * STEP + ((r.left - db.left) / db.width) * 140;
    showAt[i] = at;
    sp.animate(
      [
        { opacity: 0, filter: "blur(2px)", transform: "translateY(4px)" },
        { opacity: 1, filter: "blur(0)", transform: "none" },
      ],
      {
        duration: 380,
        delay: at - (performance.now() - now),
        easing: "cubic-bezier(.2,.7,.2,1)",
        fill: "forwards",
      },
    );
    last = Math.max(last, at + 380);
  });
  last = Math.max(last, formEnd);
  // The bubble's edge follows the text: each line opens as it forms, never empty bubble waiting for words.
  const lineInfo = new Map<number, { bottom: number; at: number }>();
  b.forEach((sp, i) => {
    const r = sp.getBoundingClientRect(),
      key = lb0[i]!;
    const at = showAt[i]! + (anim(lb[i]!) ? MELT * 0.4 : 60);
    const cur = lineInfo.get(key) ?? { bottom: 0, at: Infinity };
    lineInfo.set(key, {
      bottom: Math.max(cur.bottom, r.bottom - bb.top + 12),
      at: Math.min(cur.at, at),
    });
  });
  const H = bb.height,
    start = ARRIVE - 160,
    round = getComputedStyle(bubble).borderTopLeftRadius;
  const keys = [...lineInfo.keys()].sort((x, y) => x - y);
  const endAt = Math.max(start + 200, ...keys.map((k) => lineInfo.get(k)!.at)) + 260;
  let tPrev = start;
  let frames: Keyframe[] = [
    { offset: 0, clipPath: `inset(0 0 100% 0 round ${round})`, opacity: 0 },
  ];
  for (const k of keys) {
    const { bottom, at } = lineInfo.get(k)!;
    tPrev = Math.max(tPrev, at);
    const cut = Math.max(0, H - (k === keys.at(-1) ? H : bottom));
    frames.push({
      offset: (tPrev - start) / (endAt - start),
      clipPath: `inset(0 0 ${cut}px 0 round ${round})`,
      opacity: 1,
    });
  }
  frames.push({ offset: 1, clipPath: `inset(0 0 0 0 round ${round})`, opacity: 1 });
  frames = frames.filter(
    (f, i) => i === 0 || (f.offset as number) >= (frames[i - 1]!.offset as number),
  );
  edge = () =>
    s.bubble!.animate(frames, {
      duration: endAt - start,
      delay: start - (performance.now() - now),
      easing: "linear",
      fill: "backwards",
    });
  edge();
  kick();
  later(s, last + 60, finishSend);
}
