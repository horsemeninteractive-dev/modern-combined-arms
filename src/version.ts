/**
 * Release identity, compiled in at build time.
 *
 * The values are injected by `define` in vite.config.ts: the semantic version
 * and release stage come from package.json, the build number from the
 * repository's commit count. Keeping them out of a runtime fetch means an
 * installed, offline build still names itself correctly.
 *
 * The `typeof` guards keep a module that is somehow bundled without the
 * defines (a stray script, an older toolchain) from throwing at import time.
 */

const FALLBACK_VERSION = '0.0.0';
const FALLBACK_STAGE = 'DEV';

export const APP_VERSION: string = typeof __MCA_VERSION__ === 'string' ? __MCA_VERSION__ : FALLBACK_VERSION;
export const APP_STAGE: string = typeof __MCA_STAGE__ === 'string' ? __MCA_STAGE__ : FALLBACK_STAGE;
export const BUILD_NUMBER: number = typeof __MCA_BUILD__ === 'number' ? __MCA_BUILD__ : 0;
export const BUILD_COMMIT: string = typeof __MCA_COMMIT__ === 'string' ? __MCA_COMMIT__ : 'dev';

/** `v0.1.0 BETA` — the product version without the build. */
export const VERSION_LABEL = `v${APP_VERSION} ${APP_STAGE}`;

/** `BUILD 4` — the commit count, for the menu footer and support reports. */
export const BUILD_LABEL = `BUILD ${BUILD_NUMBER}`;

/** The one-line stamp used by the menu footer and the changelog header. */
export const VERSION_LINE = `${VERSION_LABEL} · ${BUILD_LABEL}`;

/** Provenance for a tooltip; commit is `dev` outside a git checkout. */
export function versionTitle(): string {
  return `Irontide Engine · ${VERSION_LINE} · commit ${BUILD_COMMIT}`;
}
