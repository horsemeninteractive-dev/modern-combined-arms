import './style.css';
import { App } from './app';

function fail(message: string): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="fatal-screen">
      <div class="fatal-card">
        <span class="eyebrow">SYSTEM FAULT</span>
        <h1>MCA cannot start</h1>
        <p>${message}</p>
        <p class="fatal-note">Modern Combined Arms needs WebGL2. Enable hardware acceleration in a current Chrome, Edge, Firefox or Safari browser, then reload the page.</p>
        <button class="btn btn-primary" onclick="location.reload()">RELOAD</button>
      </div>
    </div>`;
}

try {
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
  const overlay = document.getElementById('overlay') as HTMLCanvasElement | null;
  if (!canvas || !overlay) throw new Error('The battlefield canvas is missing from the document.');
  const app = new App(canvas, overlay);
  (window as unknown as { ironTide?: App }).ironTide = app;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  fail(message);
}
