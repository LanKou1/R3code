// Ported from TenonHarness (src/renderer/src/DotField.tsx + the home screen in Chat.tsx).
// Shown where T3 draws an empty thread: the breathing dot field, one question, and T3's own composer below.
import { useGT } from "gt-react";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useComposerDraftStore } from "~/composerDraftStore";
import { dotsSendStarted, inkColor, SIGNAL } from "./sendMotion";

const SPACING = 20;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const EDITOR = '[data-testid="composer-editor"]';

type Pulse = {
  at: number;
  speed: number;
  width: number;
  amp: number;
  life: number;
  hot?: boolean;
  x?: number;
  y?: number;
};

// The first send: a few violet drops land at random spots and the field clears outward from each,
// the TenonHarness way (each dot swells, flashes violet, gone), slow start then faster.
const FALL_MS = 420,
  DROPS = 4,
  POP = 0.06,
  SCATTER_MS = 3200;

/** A breathing dot grid over the whole conversation area. It leans toward the composer while
 *  you're in it and ripples as you type. Canvas because it is thousands of dots. It stays up past
 *  `active` going false only to clear from a send, then unmounts, so nothing repaints after. */
export function TenonDotField({ active }: { active: boolean }) {
  const [clearFrom, setClearFrom] = useState<DOMRect | null>(null);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    setClearFrom(active ? null : dotsSendStarted());
  }
  return active || clearFrom ? (
    <DotCanvas clearFrom={active ? null : clearFrom} onCleared={() => setClearFrom(null)} />
  ) : null;
}

function DotCanvas({ clearFrom, onCleared }: { clearFrom: DOMRect | null; onCleared: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const sending = useRef<{ box: DOMRect; done: () => void } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the send to the running canvas loop
  useLayoutEffect(() => {
    sending.current = clearFrom ? { box: clearFrom, done: onCleared } : null;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the canvas loop and the document focus/typing listeners while mounted
  useEffect(() => {
    const l = {
      focused: false,
      focusAmt: 0,
      pulses: [] as Pulse[],
      reduce: reduced(),
      drops: [] as { at: number; x: number; y0: number; y1: number }[],
      lands: [] as { x: number; y: number; at: number }[],
      sent: false,
    };
    const pulse = (p: Omit<Pulse, "at">) => {
      if (!l.reduce) l.pulses.push({ at: performance.now(), ...p });
    };
    const inEditor = (e: Event) => e.target instanceof Element && !!e.target.closest(EDITOR);
    const onIn = (e: FocusEvent) => {
      if (inEditor(e) && !l.focused) pulse({ speed: 760, width: 46, amp: 1, life: 1.5 });
      if (inEditor(e)) l.focused = true;
    };
    const onOut = (e: FocusEvent) => {
      if (inEditor(e)) l.focused = false;
    };
    const onType = (e: Event) => {
      if (inEditor(e)) pulse({ speed: 520, width: 16, amp: 0.7, life: 0.9, hot: true });
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    document.addEventListener("input", onType, true);

    const t0 = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const c = cv.current;
      if (!c) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const box = c.getBoundingClientRect();
      const W = box.width,
        H = box.height,
        dpr = devicePixelRatio || 1;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const ink = inkColor();

      const t = l.reduce ? 0 : (now - t0) / 1000;
      const fade = Math.min(1, (now - t0) / 900);
      l.focusAmt += ((l.focused ? 1 : 0) - l.focusAmt) * 0.06;
      l.pulses = l.pulses.filter((p) => now - p.at < p.life * 1000);
      const cols = Math.ceil(W / SPACING) + 1,
        rows = Math.ceil(H / SPACING) + 1;
      const ox = (W - (cols - 1) * SPACING) / 2,
        oy = (H - (rows - 1) * SPACING) / 2;

      const send = sending.current;
      if (send && !l.sent) {
        l.sent = true;
        const fb = {
          l: send.box.left - box.left,
          t: send.box.top - box.top,
          r: send.box.right - box.left,
          b: send.box.bottom - box.top,
        };
        for (let n = 0, tries = 0; n < DROPS && tries < 200; tries++) {
          const gx = ox + Math.round((W * (0.08 + 0.84 * Math.random()) - ox) / SPACING) * SPACING;
          const gy = oy + Math.round((H * (0.12 + 0.76 * Math.random()) - oy) / SPACING) * SPACING;
          const nearBox = gx > fb.l - 40 && gx < fb.r + 40 && gy > fb.t - 40 && gy < fb.b + 40;
          const nearOther = l.drops.some(
            (d) => Math.hypot(d.x - gx, d.y1 - gy) < Math.min(W, H) * 0.28,
          );
          if (nearBox || nearOther) continue;
          const fall = 90 + Math.random() * 70;
          l.drops.push({ at: now + n * (110 + Math.random() * 120), x: gx, y0: gy - fall, y1: gy });
          n++;
        }
      }
      for (const d of l.drops)
        if (now - d.at >= FALL_MS) {
          pulse({ x: d.x, y: d.y1, speed: 210, width: 7, amp: 0.95, life: 1.5, hot: true });
          l.lands.push({ x: d.x, y: d.y1, at: now });
        }
      l.drops = l.drops.filter((d) => now - d.at < FALL_MS);
      if (send && l.sent && !l.drops.length && l.lands.every((s) => now - s.at > SCATTER_MS)) {
        g.clearRect(0, 0, W, H);
        send.done();
        return;
      }
      const maxD = Math.hypot(W, H) * 0.7;
      const Ps = l.lands.map((s) => ({
        s,
        P: 1.2 * Math.min(1, (now - s.at) / SCATTER_MS) ** 2.2,
      }));

      const rel = (el: Element) => {
        const a = el.getBoundingClientRect();
        return {
          l: a.left - box.left,
          t: a.top - box.top,
          r: a.right - box.left,
          b: a.bottom - box.top,
        };
      };
      let fx = W / 2,
        fy = H / 2;
      const composer = document.querySelector("[data-chat-composer-form]");
      if (composer) {
        const r = rel(composer);
        fx = (r.l + r.r) / 2;
        fy = (r.t + r.b) / 2;
      }

      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const x = ox + i * SPACING,
            y = oy + j * SPACING;
          // slow drifting interference, so the field breathes in patches
          let v =
            Math.sin(x * 0.011 + t * 0.55) * Math.sin(y * 0.014 - t * 0.4) +
            0.7 * Math.sin((x - y) * 0.006 + t * 0.75) +
            0.5 * Math.sin(Math.hypot(x - W * 0.3, y - H * 0.75) * 0.012 - t * 0.9);
          v = Math.min(1, Math.max(0, (v / 2.2) * 0.5 + 0.5));
          v = v * v * (3 - 2 * v);
          let a = 0.05 + 0.4 * v,
            r = 0.6 + 1.5 * v,
            hot = 0;
          const df = Math.hypot(x - fx, y - fy);
          if (l.focusAmt > 0.01) {
            const k = Math.max(0, 1 - df / 460) * l.focusAmt;
            a += 0.22 * k;
            r += 0.5 * k;
          }
          for (const p of l.pulses) {
            const dist = p.x == null ? df : Math.hypot(x - p.x, y - p.y!);
            const age = (now - p.at) / 1000,
              d = dist - age * p.speed;
            const w = Math.exp(-(d * d) / (2 * p.width * p.width)) * p.amp * (1 - age / p.life);
            a += 0.55 * w;
            r += 1.4 * w;
            if (p.hot) hot = Math.max(hot, w);
          }
          if (Ps.length) {
            // TenonHarness's per-dot moment, measured from the nearest landing instead of the screen centre
            const rnd = Math.abs((Math.sin(i * 127.1 + j * 311.7) * 43758.5453) % 1);
            const n =
              0.5 +
              0.25 * Math.sin(x * 0.009 + 1.7) * Math.sin(y * 0.011 + 0.4) +
              0.25 * Math.sin((x + 2 * y) * 0.005 + 2.3);
            let gone = false,
              pop = -1;
            for (const { s, P } of Ps) {
              const thr =
                0.02 + (0.6 * Math.hypot(x - s.x, y - s.y)) / maxD + 0.22 * n + 0.18 * rnd;
              if (P >= thr) {
                gone = true;
                break;
              }
              if (P > thr - POP) pop = Math.max(pop, 1 - (thr - P) / POP);
            }
            if (gone) continue;
            if (pop >= 0) {
              const k = 1 - pop;
              r = r * k + 6.4 * (1 - k) * k;
              a = Math.max(a, 0.9) * Math.min(1, k * 3);
              hot = 1;
            }
          }
          a *= fade;
          if (a < 0.01 || r < 0.2) continue;
          g.globalAlpha = Math.min(1, a);
          g.fillStyle = hot > 0.55 ? SIGNAL : ink;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      // the falling drop: gravity ease-in, stretches a little as it speeds up
      for (const d of l.drops) {
        if (now < d.at) continue;
        const k = Math.min(1, (now - d.at) / FALL_MS),
          e = k * k;
        g.globalAlpha = Math.min(1, k * 5);
        g.fillStyle = SIGNAL;
        g.shadowColor = SIGNAL;
        g.shadowBlur = 8;
        g.beginPath();
        g.ellipse(d.x, d.y0 + (d.y1 - d.y0) * e, 2.6, 2.6 * (1 + 1.6 * e), 0, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
      }
      g.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
      document.removeEventListener("input", onType, true);
    };
  }, []);

  return (
    <canvas ref={cv} aria-hidden className="pointer-events-none absolute inset-0 z-0 size-full" />
  );
}

const KEY =
  "grid size-[30px] place-items-center rounded-lg bg-muted text-foreground transition-colors hover:bg-accent active:translate-y-[2px]";

// The AI as a 4x4 dot glyph instead of a name (Tenon's "disc" for any model).
const DISC = Array.from("0110111111110110", (b, i) => ({
  id: `r${i >> 2}c${i & 3}`,
  on: b === "1",
}));

type Effort = {
  levels: ReadonlyArray<{ id: string; label: string }>;
  current: string | null;
} | null;

const DEG0 = -150; // the lowest level sits at 7 o'clock, the highest at 5 o'clock

/** How hard the AI thinks, Tenon's dial on T3's real levels. A bare glyph at rest; held, it grows, shows its detents
 *  and points where the cursor is. Scroll or arrow keys step it. It reads the level from the composer, so it always
 *  agrees with T3's own picker. */
function EffortKnob({ read, step }: { read: () => Effort; step: (d: 1 | -1) => void }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  // Re-read after any draft change (a pick in T3's menu, a model switch), a frame later so the composer has caught up.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the composer draft store
  useEffect(() => useComposerDraftStore.subscribe(() => requestAnimationFrame(redraw)), []);
  const effort = read();
  const n = effort?.levels.length ?? 0;
  const idx = Math.max(0, effort?.levels.findIndex((l) => l.id === effort.current) ?? 0);
  const [open, setOpen] = useState(false);
  const [aimAt, setAimAt] = useState<number | null>(null);
  const held = useRef(false);
  const hide = useRef(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the readout's hide timer on unmount
  useEffect(() => () => clearTimeout(hide.current), []);
  const gt = useGT();
  if (!effort || n < 2) return null;
  const DEG = 300 / (n - 1);
  const at = aimAt ?? idx;

  // Walk to a level one step at a time through T3's own stepper, waiting for the composer between steps.
  const goTo = (target: number, left = n + 1) => {
    const now = read();
    const i = now ? now.levels.findIndex((l) => l.id === now.current) : -1;
    if (i < 0 || i === target || left <= 0) return;
    step(target > i ? 1 : -1);
    setTimeout(() => goTo(target, left - 1), 40);
  };
  const linger = (ms: number) => {
    clearTimeout(hide.current);
    hide.current = window.setTimeout(() => {
      if (!held.current) setOpen(false);
    }, ms);
  };
  const aim = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2),
      dy = e.clientY - (r.top + r.height / 2);
    if (dx * dx + dy * dy < 64) return null; // dead zone over the centre
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    let best = 0,
      bestD = 360;
    for (let p = 0; p < n; p++) {
      const d = Math.abs(((((deg - (DEG0 + p * DEG)) % 360) + 540) % 360) - 180);
      if (d < bestD) [bestD, best] = [d, p];
    }
    return best;
  };
  const nudge = (d: 1 | -1) => {
    setOpen(true);
    step(d);
    linger(1200);
  };
  const spot = (p: number) => {
    const r = ((DEG0 + p * DEG) * Math.PI) / 180;
    return { cx: 29 + 24 * Math.sin(r), cy: 29 - 24 * Math.cos(r) };
  };
  const label = effort.levels[at]?.label ?? "";

  return (
    <div className="relative flex items-center">
      {/* The readout: which level, and where it sits in the range. */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-full mr-1 flex items-baseline gap-1.5 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-background transition-opacity"
        style={{ opacity: open ? 1 : 0, fontFamily: "Archivo, var(--font-sans)" }}
      >
        <span className="text-xs font-light">{label.toLowerCase()}</span>
        <span className="font-mono text-3xs opacity-60">
          {at + 1}/{n}
        </span>
      </span>
      <button
        type="button"
        aria-label={gt("How hard it thinks: {level}. Hold and turn, or scroll.", {
          level: effort.levels[idx]?.label ?? "",
        })}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          held.current = true;
          clearTimeout(hide.current);
          setOpen(true);
        }}
        onPointerMove={(e) => {
          if (!held.current) return;
          const p = aim(e);
          if (p !== null) setAimAt(p);
        }}
        onPointerUp={() => {
          if (!held.current) return;
          held.current = false;
          if (aimAt !== null) goTo(aimAt);
          setAimAt(null);
          linger(900);
        }}
        onPointerCancel={() => {
          held.current = false;
          setAimAt(null);
          linger(300);
        }}
        onWheel={(e) => nudge(e.deltaY < 0 ? 1 : -1)}
        onKeyDown={(e) => {
          const d = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 } as const)[
            e.key as "ArrowRight"
          ];
          if (!d) return;
          e.preventDefault();
          nudge(d);
        }}
        className="group relative grid shrink-0 cursor-grab touch-none place-items-center focus-visible:outline-none active:cursor-grabbing"
        style={{
          width: open ? 64 : 44,
          height: open ? 64 : 44,
          transition: "width .3s cubic-bezier(.4,0,.2,1), height .3s cubic-bezier(.4,0,.2,1)",
        }}
      >
        <svg
          width="58"
          height="58"
          viewBox="0 0 58 58"
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 -mt-[29px] -ml-[29px]"
          style={{ opacity: open ? 1 : 0, transition: "opacity .2s" }}
        >
          {effort.levels.map((l, i) => (
            <circle
              key={l.id}
              {...spot(i)}
              r={i === at ? 2.6 : 1.5}
              fill={i === at ? SIGNAL : "currentColor"}
              opacity={i === at ? 1 : 0.5}
            />
          ))}
        </svg>
        <span
          aria-hidden
          className="relative rounded-full group-focus-visible:outline-2 group-focus-visible:outline-foreground"
          style={{
            width: open ? 34 : 16,
            height: open ? 34 : 16,
            border: `1.5px solid ${open ? "transparent" : "currentColor"}`,
            background: open ? "var(--muted)" : "transparent",
            boxShadow: open ? "0 2px 0 rgba(0,0,0,0.35)" : "none",
            transition:
              "width .3s cubic-bezier(.4,0,.2,1), height .3s cubic-bezier(.4,0,.2,1), background .2s",
          }}
        >
          <span
            className="absolute inset-0 rounded-full"
            style={{
              transform: `rotate(${DEG0 + at * DEG}deg)`,
              transition: "transform .18s cubic-bezier(.2,.8,.2,1)",
            }}
          >
            <span className="absolute top-[12%] left-1/2 -ml-px h-[34%] w-0.5 rounded-xs bg-foreground" />
          </span>
        </span>
      </button>
    </div>
  );
}

/** Tenon's quiet row under the input, icons only: start in a folder, which AI, how hard it thinks.
 *  Wired to T3: the folder opens "add project", the AI key opens T3's model picker, the knob reads and sets T3's effort. */
export function TenonKeys({
  onFolder,
  onModel,
  readEffort,
  stepEffort,
}: {
  onFolder: () => void;
  onModel: () => void;
  readEffort: () => Effort;
  stepEffort: (direction: 1 | -1) => void;
}) {
  const gt = useGT();
  const folder = gt("Open a folder");
  const model = gt("Which AI");
  return (
    <div className="flex items-center justify-end gap-1.5 pr-2.5 text-foreground">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onFolder}
              aria-label={folder}
              className={KEY}
              data-rc-key=""
            />
          }
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13z" />
          </svg>
        </TooltipTrigger>
        <TooltipPopup side="top">{folder}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onModel}
              aria-label={model}
              className={KEY}
              data-rc-key=""
            />
          }
        >
          <span aria-hidden className="grid grid-cols-[repeat(4,3px)] gap-0.5">
            {DISC.map((d) => (
              <span
                key={d.id}
                className={`size-[3px] rounded-full ${d.on ? "bg-foreground" : "bg-muted-foreground/40"}`}
              />
            ))}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">{model}</TooltipPopup>
      </Tooltip>
      <EffortKnob read={readEffort} step={stepEffort} />
    </div>
  );
}
