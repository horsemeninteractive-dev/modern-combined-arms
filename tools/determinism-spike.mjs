#!/usr/bin/env node
/**
 * Cross-browser determinism spike.
 *
 * Serves the isolated tools/determinism harness through Vite, runs it in
 * Chromium, Firefox and WebKit, and compares the state hash sampled every 100
 * ticks. The result is written to tmp/determinism-spike.json and printed.
 *
 *   npm run determinism:spike
 *
 * Playwright browsers must be installed once:
 *   npx playwright install chromium firefox webkit
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'vite';

const PORT = 5174;
const RUN_TIMEOUT_MS = 180_000;
const engines = { chromium, firefox, webkit };
const selectedEngines = (process.env.MCA_ENGINES ?? 'chromium,firefox,webkit')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name in engines);

function firstMismatch(baselineSamples, otherSamples) {
  const otherByTick = new Map(otherSamples.map((sample) => [sample.tick, sample.hash]));
  for (const sample of baselineSamples) {
    const other = otherByTick.get(sample.tick);
    if (other === undefined) {
      return {
        tick: sample.tick,
        kind: 'missing-sample',
        chromium: sample.hash,
        other: null,
      };
    }
    if (other !== sample.hash) {
      const chromiumParts = sample.hash.split('|');
      const otherParts = other.split('|');
      let index = 0;
      while (
        index < chromiumParts.length &&
        index < otherParts.length &&
        chromiumParts[index] === otherParts[index]
      ) {
        index++;
      }
      const part = chromiumParts[index] ?? otherParts[index] ?? '';
      return {
        tick: sample.tick,
        kind: part.startsWith('t=')
          ? 'clock'
          : part.startsWith('r=')
            ? 'rng'
            : part.startsWith('v=')
              ? 'victory'
              : part.startsWith('p')
                ? 'player'
                : part.startsWith('j')
                  ? 'projectile'
                  : part.startsWith('k')
                    ? 'smoke'
                    : part.startsWith('m=')
                      ? 'mission'
                      : part.startsWith('e')
                        ? 'entity'
                        : 'unknown',
        partIndex: index,
        chromiumPart: chromiumParts[index] ?? null,
        otherPart: otherParts[index] ?? null,
        chromium: sample.hash,
        other,
      };
    }
  }
  return null;
}

async function main() {
  const server = await createServer({
    configFile: 'vite.config.ts',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
    logLevel: 'error',
  });

  await server.listen();
  const baseUrl = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${PORT}/`;
  const url = new URL('tools/determinism/', baseUrl).href;
  const report = {
    url,
    startedAt: new Date().toISOString(),
    engines: {},
    identical: null,
  };

  try {
    for (const name of selectedEngines) {
      const engine = engines[name];
      let browser;
      try {
        browser = await engine.launch({
          headless: true,
          ...(name === 'chromium'
            ? { channel: process.env.MCA_CHROMIUM_CHANNEL ?? 'chromium' }
            : {}),
        });
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(String(error)));
        await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
        await page.waitForFunction(
          () => Boolean(globalThis.__MCA_DETERMINISM__),
          null,
          { timeout: RUN_TIMEOUT_MS },
        );
        const result = await page.evaluate(() => globalThis.__MCA_DETERMINISM__);
        report.engines[name] = { ...result, pageErrors };
      } catch (error) {
        report.engines[name] = {
          ok: false,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        };
      } finally {
        await browser?.close();
      }
    }
  } finally {
    await server.close();
  }

  const baseline = report.engines.chromium;
  if (!baseline?.ok || !Array.isArray(baseline.samples)) {
    report.identical = false;
    report.error = 'Chromium did not produce a baseline.';
  } else {
    report.identical = true;
    for (const name of ['firefox', 'webkit']) {
      const result = report.engines[name];
      if (!result?.ok || !Array.isArray(result.samples)) {
        report.identical = false;
        report[`${name}Error`] = result?.error ?? 'No sample set.';
        continue;
      }
      const mismatch = firstMismatch(baseline.samples, result.samples);
      report[`${name}Match`] = mismatch === null;
      if (mismatch) {
        report.identical = false;
        report[`${name}FirstMismatch`] = mismatch;
      }
    }
  }

  await mkdir('tmp', { recursive: true });
  await writeFile('tmp/determinism-spike.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const summary = {
    identical: report.identical,
    engines: Object.fromEntries(
      Object.entries(report.engines).map(([name, result]) => [
        name,
        result.ok
          ? {
              ok: true,
              ticks: result.ticks,
              samples: result.samples?.length ?? 0,
              elapsedMs: result.elapsedMs,
              pageErrors: result.pageErrors ?? [],
            }
          : { ok: false, error: result.error },
      ]),
    ),
    firefoxFirstMismatch: report.firefoxFirstMismatch ?? null,
    webkitFirstMismatch: report.webkitFirstMismatch ?? null,
    errors: [report.error, report.firefoxError, report.webkitError].filter(Boolean),
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nFull hashes written to tmp/determinism-spike.json`);

  const completed = Object.values(report.engines).every((result) => result?.ok);
  if (!completed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
