import './style.css';
import './missionWorkbench.css';
import { App } from './app';
import { escapeHtml } from './ui/modal';

// The bundled stylesheet is live by the time this module body runs, so the
// inline first-paint plate in index.html can hand the screen over. Doing it
// here also covers the failure path below: the fault card is always styled.
document.documentElement.classList.remove('booting');
// Hand-off: the loading reticle becomes the start button. A clone of the real
// button flies from the boot mark's box to the button's box, so the circle turns
// into the call to action while the gate's own floor, horizon and scan band
// (the same furniture the plate drew) take over behind it.
const bootPlate = document.querySelector<HTMLElement>('.boot-plate');
const bootMark = bootPlate?.querySelector<HTMLElement>('.boot-mark') ?? null;
const startButton = document.getElementById('btn-start');
const introScreen = document.getElementById('intro-screen');
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function handOver(): void {
  introScreen?.classList.remove('morphing');
  bootPlate?.remove();
  startButton?.focus({ preventScroll: true });
}

if (bootPlate && bootMark && startButton && introScreen && !calm) {
  introScreen.classList.add('arriving');
  // Measure first: `arriving` transforms the gate's plate, and the clone has to
  // land on the button's settled box rather than its entering one.
  const from = bootMark.getBoundingClientRect();
  const to = startButton.getBoundingClientRect();
  const ghost = startButton.cloneNode(true) as HTMLButtonElement;
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.tabIndex = -1;
  ghost.classList.add('intro-start-ghost');
  ghost.style.cssText = [
    'position: fixed',
    'margin: 0',
    'padding: 0',
    'min-width: 0',
    `left: ${from.left}px`,
    `top: ${from.top}px`,
    `width: ${from.width}px`,
    `height: ${from.height}px`,
    'border-radius: 50%',
    'clip-path: none',
    'z-index: 101',
  ].join('; ');
  const labels = Array.from(ghost.children) as HTMLElement[];
  for (const label of labels) label.style.opacity = '0';
  document.body.appendChild(ghost);
  introScreen.classList.add('morphing');
  // The crest and the plate's furniture dissolve into the gate's copy of them.
  bootMark.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
  bootPlate.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'linear', fill: 'forwards' });
  const morph = ghost.animate(
    [
      {
        left: `${from.left}px`, top: `${from.top}px`,
        width: `${from.width}px`, height: `${from.height}px`,
        borderRadius: '50%', borderColor: 'rgba(224, 163, 74, 0.3)',
      },
      {
        left: `${to.left}px`, top: `${to.top}px`,
        width: `${to.width}px`, height: `${to.height}px`,
        borderRadius: '14px', borderColor: 'rgba(224, 163, 74, 0.42)',
      },
    ],
    { duration: 760, delay: 120, easing: 'cubic-bezier(0.22, 0.7, 0.16, 1)', fill: 'both' },
  );
  // The words arrive once the box has widened enough to hold them.
  labels.forEach((label, index) => {
    label.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 240, delay: 540 + index * 80, easing: 'ease-out', fill: 'forwards',
    });
  });
  let landed = false;
  const land = (): void => {
    if (landed) return;
    landed = true;
    ghost.remove();
    handOver();
  };
  morph.finished.then(land, land);
  window.setTimeout(land, 1500);
} else {
  handOver();
}

// The shell worker is only registered for the built app: during development it
// would pin stale modules and fight the Vite dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // updateViaCache none: a new deployment's worker is picked up on the next
    // visit instead of waiting out an HTTP-cached copy of sw.js.
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((error: unknown) => {
      console.warn('MCA: offline shell unavailable', error);
    });
  });
}

function fail(message: string): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="fatal-screen">
      <div class="fatal-card">
        <span class="eyebrow">SYSTEM FAULT</span>
        <h1>MCA cannot start</h1>
        <p>${escapeHtml(message)}</p>
        <p class="fatal-note">Modern Combined Arms needs WebGL2. Enable hardware acceleration in a current Chrome, Edge, Firefox or Safari browser, then reload the page.</p>
        <button class="btn btn-primary" id="fatal-reload">RELOAD</button>
      </div>
    </div>`;
  // Keep the inline-event-handler ban in the CSP intact: the reload control is
  // wired after the markup is inserted instead of an inline onclick attribute.
  document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload());
}

try {
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
  const overlay = document.getElementById('overlay') as HTMLCanvasElement | null;
  const cursorLayer = document.getElementById('cursor-layer') as HTMLCanvasElement | null;
  if (!canvas || !overlay || !cursorLayer) {
    throw new Error('The battlefield canvas is missing from the document.');
  }
  const app = new App(canvas, overlay, cursorLayer);
  (window as unknown as { ironTide?: App }).ironTide = app;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  fail(message);
}
