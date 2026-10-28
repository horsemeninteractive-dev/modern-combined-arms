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

/** A saved battle records the build that wrote it. */
export interface BuildStamp {
  version: string;
  stage: string;
  build: number;
  commit: string;
}

/** The running build, for writing into save metadata and support reports. */
export function currentBuildStamp(): BuildStamp {
  return { version: APP_VERSION, stage: APP_STAGE, build: BUILD_NUMBER, commit: BUILD_COMMIT };
}

/**
 * One-line provenance for a save slot. Saves written before build stamping
 * have no stamp at all, and saying so is more useful than guessing.
 */
export function buildStampLabel(stamp: Partial<BuildStamp> | null | undefined): string {
  if (
    !stamp ||
    typeof stamp.version !== 'string' ||
    typeof stamp.stage !== 'string' ||
    typeof stamp.build !== 'number'
  ) {
    return 'Build not recorded';
  }
  const commit = typeof stamp.commit === 'string' && stamp.commit ? ` · ${stamp.commit}` : '';
  return `v${stamp.version} ${stamp.stage} · BUILD ${stamp.build}${commit}`;
}
