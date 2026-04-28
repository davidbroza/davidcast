/**
 * Tiny confetti burst — no deps. Spawns ~80 absolutely-positioned divs
 * inside <body>, each animated with a CSS transition (translate +
 * rotate + opacity) over ~1.4s, then garbage-collects them.
 *
 * Honors `prefers-reduced-motion` (silently no-ops) and is rate-limited
 * so a stuck Enter key doesn't cascade into a particle storm.
 */

const COLORS = [
  "#ff5277", "#fe6ad9", "#01cdfe", "#fff95b",
  "#05ffa1", "#ffb86b", "#bd93f9", "#7bd88f",
  "#ff9966", "#4dc4ff", "#ffe81f", "#ff69b4",
];

let lastFiredAt = 0;

export function fireConfetti(opts?: { count?: number; origin?: { x: number; y: number } }) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const now = performance.now();
  if (now - lastFiredAt < 200) return; // rate-limit bursts
  lastFiredAt = now;

  const count = opts?.count ?? 80;
  const ox = opts?.origin?.x ?? window.innerWidth / 2;
  const oy = opts?.origin?.y ?? window.innerHeight / 2;

  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  // Append to <html>, NOT <body>: body has overflow:hidden + a rounded
  // clip mask (so the rounded palette renders cleanly), which clips any
  // fixed-positioned child of body. Putting the layer on documentElement
  // escapes that mask so the particles can travel the full window.
  document.documentElement.appendChild(layer);

  const pieces: HTMLDivElement[] = [];
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const size = 6 + Math.random() * 6;
    const round = Math.random() < 0.4 ? "50%" : "2px";
    p.style.background = color;
    p.style.width = `${size}px`;
    p.style.height = `${size * (0.4 + Math.random() * 0.8)}px`;
    p.style.borderRadius = round;
    p.style.left = `${ox}px`;
    p.style.top = `${oy}px`;
    p.style.transform = `translate(-50%, -50%) rotate(${Math.random() * 360}deg)`;
    p.style.transition = "transform 1.2s cubic-bezier(.2,.7,.2,1), opacity 1.4s ease-out";
    layer.appendChild(p);
    pieces.push(p);
  }

  // Defer the transform mutation to the next frame so the browser has
  // a chance to paint the initial state — without this the transition
  // doesn't engage and the particles teleport.
  requestAnimationFrame(() => {
    for (const p of pieces) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 140 + Math.random() * 220;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance + 80; // gravity bias
      const rot = (Math.random() - 0.5) * 720;
      p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`;
      p.style.opacity = "0";
    }
  });

  window.setTimeout(() => layer.remove(), 1500);
}
