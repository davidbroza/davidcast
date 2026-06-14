/**
 * Heat-vision burst — the laser counterpart to `fireConfetti`. Spawns N
 * thin red beams radiating from an origin point, each animated from a
 * zero-width line to a screen-spanning beam with a bright white core, then
 * fades. Used by the "The Boys" theme on commit and by the `fx.lasers`
 * built-in command.
 *
 * Honors `prefers-reduced-motion` (silently no-ops) and rate-limited so a
 * stuck Enter doesn't pile up beams on top of each other.
 */

let lastFiredAt = 0;

export function fireLasers(opts?: {
  count?: number;
  origin?: { x: number; y: number };
}) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const now = performance.now();
  if (now - lastFiredAt < 200) return;
  lastFiredAt = now;

  const count = opts?.count ?? 16;
  const ox = opts?.origin?.x ?? window.innerWidth / 2;
  const oy = opts?.origin?.y ?? window.innerHeight * 0.35;

  // Same escape-the-rounded-clip trick confetti uses.
  const layer = document.createElement("div");
  layer.className = "laser-layer";
  document.documentElement.appendChild(layer);

  const beams: HTMLDivElement[] = [];

  // Two iconic Homelander-style parallel eye-beams: slightly off-center,
  // close to horizontal, brighter and thicker than the radial fill.
  const eyeOffset = 22; // px between "eyes"
  for (const dx of [-eyeOffset, eyeOffset]) {
    const b = makeBeam(ox + dx, oy, 0, { thickness: 4, intensity: 1 });
    layer.appendChild(b);
    beams.push(b);
  }

  // Radial spray — gives the burst its energy without losing the
  // signature horizontal-beams silhouette.
  for (let i = 0; i < count; i++) {
    const angle = (Math.random() - 0.5) * Math.PI * 0.9; // mostly forward-ish
    const flip = Math.random() < 0.5 ? 0 : Math.PI; // either left or right
    const b = makeBeam(ox, oy, angle + flip, {
      thickness: 2,
      intensity: 0.85,
    });
    layer.appendChild(b);
    beams.push(b);
  }

  requestAnimationFrame(() => {
    for (const b of beams) {
      b.style.width = b.dataset.targetWidth!;
      b.style.opacity = "0";
    }
  });

  // Beams travel fast and fade fast — heat vision is a flash, not a
  // celebration. Tear down a beat after the longest transition ends.
  window.setTimeout(() => layer.remove(), 900);
}

function makeBeam(
  x: number,
  y: number,
  angleRad: number,
  o: { thickness: number; intensity: number }
): HTMLDivElement {
  const b = document.createElement("div");
  b.className = "laser-beam";
  // Length is window-diagonal-ish so the beam always crosses the screen.
  const diag = Math.hypot(window.innerWidth, window.innerHeight);
  const target = diag * (0.6 + Math.random() * 0.4);
  b.dataset.targetWidth = `${target}px`;
  b.style.left = `${x}px`;
  b.style.top = `${y}px`;
  b.style.height = `${o.thickness}px`;
  b.style.opacity = String(o.intensity);
  // Origin at the beam start; rotate to fire direction.
  b.style.transform = `translateY(-50%) rotate(${angleRad}rad)`;
  // Slight per-beam timing jitter so they don't fire as one synchronized wall.
  const dur = 0.45 + Math.random() * 0.25;
  b.style.transition = `width ${dur}s cubic-bezier(.2,.85,.25,1), opacity ${
    dur + 0.15
  }s ease-out`;
  return b;
}
