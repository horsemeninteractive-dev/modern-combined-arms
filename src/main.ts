import './style.css';
import './missionWorkbench.css';
import { App } from './app';
import { escapeHtml } from './ui/modal';

// The bundled stylesheet is live by the time this module body runs, so the
// inline first-paint plate in index.html can hand the screen over. Doing it
// here also covers the failure path below: the fault card is always styled.
document.documentElement.classList.remove('booting');

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
