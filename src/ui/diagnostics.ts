/**
 * Build diagnostics for bug reports.
 *
 * The block is deliberately short and line-oriented: version, build, map and
 * tick are the four facts needed to reproduce a report, and a player can paste
 * it into a message without formatting. Clipboard access is best-effort: the
 * async API is used when the browser allows it, with a selection fallback for
 * insecure origins where `navigator.clipboard` is absent.
 */
import { APP_STAGE, APP_VERSION, BUILD_COMMIT, BUILD_NUMBER } from '../version';

export interface DiagnosticsInput {
  mapName: string;
  mapId: string;
  tick: number;
}

export function diagnosticsText(input: DiagnosticsInput): string {
  return [
    `MCA v${APP_VERSION} ${APP_STAGE}`,
    `Build ${BUILD_NUMBER} · commit ${BUILD_COMMIT}`,
    `Map ${input.mapName} (${input.mapId})`,
    `Tick ${input.tick}`,
  ].join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Permission or policy can reject this; the fallback may still work. */
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '0';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  } catch {
    return false;
  }
}
