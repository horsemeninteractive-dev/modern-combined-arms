// The project ships without @types/node on purpose: browser modules must not
// see Node globals. The build config and the Node-side tests need exactly
// these builtins, so they are declared here rather than installing the whole
// Node API surface.
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function readFileSync(path: string | URL): Uint8Array;
  export function existsSync(path: string | URL): boolean;
}

declare module 'node:vm' {
  export function runInNewContext(code: string, contextObject?: Record<string, unknown>): unknown;
}

declare module 'node:child_process' {
  export function execSync(command: string, options: { encoding: 'utf8' }): string;
}

// Imported rather than declared globally, so the browser bundle cannot see a
// `process` symbol it would then be tempted to use.
declare module 'node:process' {
  const process: { env: Record<string, string | undefined> };
  export default process;
}
