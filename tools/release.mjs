#!/usr/bin/env node
/**
 * One-command release: check the declared version, build, ship to Pages, and
 * prove the new bundle is the one being served.
 *
 *   npm run release                # validate, test, build, deploy, verify
 *   npm run release -- --dry-run   # everything except the upload
 *   npm run release -- --skip-tests
 *   npm run release -- --allow-dirty
 *
 * The build stamp is the commit count, so a release normally starts from a
 * clean tree: `--allow-dirty` ships whatever is on disk under the previous
 * commit's number, which is useful for a hotfix preview but not for a release.
 *
 * The upload uses the project-local `npx wrangler` cache and whatever
 * credentials are already on the machine (`npx wrangler login` once). Project,
 * branch and public URL are overridable with PAGES_PROJECT, PAGES_BRANCH and
 * PAGES_URL.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipTests = args.has('--skip-tests');
const allowDirty = args.has('--allow-dirty');

const PROJECT = process.env.PAGES_PROJECT ?? 'moderncombinedarms';
const BRANCH = process.env.PAGES_BRANCH ?? 'main';
const SITE = process.env.PAGES_URL ?? 'https://moderncombinedarms.pages.dev';
const WRANGLER = ['--yes', 'wrangler@4'];

function step(label) {
  console.log(`\n\u25b8 ${label}`);
}

function fail(message) {
  console.error(`\n\u2716 ${message}`);
  process.exit(1);
}

/** Quote a value for a shell command line; the inputs are local config only. */
function quote(value) {
  return `"${String(value).replaceAll('"', '')}"`;
}

/**
 * npm and npx are shell shims on Windows, so they need `shell: true`. Passing a
 * finished command line rather than an argument array keeps Node from warning
 * that it would concatenate the arguments unescaped anyway.
 */
function runShell(command) {
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  return result.status ?? 1;
}

function captureShell(command) {
  const result = spawnSync(command, { encoding: 'utf8', shell: true });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  return { status: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** git is a real executable everywhere, so it needs no shell. */
function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) fail(`git could not start: ${result.error.message}`);
  return { status: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const stage = String(pkg.releaseStage ?? 'BETA').toUpperCase();
const label = `${version} ${stage}`;

console.log(`MCA release \u2014 v${label}${dryRun ? ' (dry run)' : ''}`);

step('Checking the declared version');
const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.includes(`## [${label}]`)) {
  fail(`CHANGELOG.md has no "## [${label}]" section. Write the notes before releasing.`);
}
const html = readFileSync('index.html', 'utf8');
if (!html.includes(`id="menu-build">v${label} \u00b7 BUILD`)) {
  fail(`index.html's menu footer does not read v${label}. Fix the static stamp.`);
}
console.log(`  package.json, CHANGELOG.md and the menu footer agree on v${label}`);

step('Checking the working tree');
const dirty = git(['status', '--porcelain']).out.trim();
if (dirty && !allowDirty) {
  console.error(dirty.split('\n').slice(0, 12).map((line) => `  ${line.trimStart()}`).join('\n'));
  fail('The tree is dirty. Commit the release first, or pass --allow-dirty.');
}
console.log(dirty ? '  shipping an uncommitted tree (--allow-dirty)' : '  clean');

if (!skipTests) {
  step('Running the test suite');
  if (runShell('npm test') !== 0) fail('Tests failed. Nothing was deployed.');
}

step('Building the production bundle');
if (runShell('npm run build') !== 0) fail('Build failed. Nothing was deployed.');

const builtHtml = readFileSync('dist/index.html', 'utf8');
const bundle = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(builtHtml)?.[0];
if (!bundle) fail('dist/index.html references no bundle.');
const bundleSource = readFileSync(`dist/${bundle}`, 'utf8');
const stamp = /BUILD (\d+)/.exec(bundleSource)?.[1] ?? '?';
const commits = git(['rev-list', '--count', 'HEAD']).out.trim();
console.log(`  ${bundle} \u00b7 v${label} \u00b7 BUILD ${stamp} (HEAD is ${commits} commits)`);

if (dryRun) {
  console.log(`\nDry run: would deploy dist/ to ${PROJECT} (${BRANCH}).`);
  process.exit(0);
}

step(`Deploying to Cloudflare Pages \u00b7 ${PROJECT}`);
const deployCommand = [
  'npx',
  ...WRANGLER,
  'pages deploy dist',
  `--project-name ${quote(PROJECT)}`,
  `--branch ${quote(BRANCH)}`,
  dirty ? '--commit-dirty=true' : '',
]
  .filter(Boolean)
  .join(' ');
const deploy = captureShell(deployCommand);
process.stdout.write(deploy.out);
if (deploy.status !== 0) fail('The upload failed. The previous deployment is still live.');
const preview = /https:\/\/[a-z0-9]+\.moderncombinedarms\.pages\.dev/.exec(deploy.out)?.[0];
if (preview) console.log(`  uploaded: ${preview}`);

step('Waiting for the live site to serve this bundle');
const deadline = Date.now() + 90_000;
let live = null;
while (Date.now() < deadline) {
  try {
    const html = await fetch(`${SITE}/?release=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text());
    const liveBundle = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
    if (liveBundle === bundle) {
      live = liveBundle;
      break;
    }
    if (liveBundle) console.log(`  still serving ${liveBundle} \u2014 retrying`);
  } catch (error) {
    console.log(`  ${SITE} not answering yet \u2014 retrying`);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!live) fail(`${SITE} did not serve ${bundle} within 90 s. Check the deployment in the Pages dashboard.`);

console.log(`\n\u2714 Released v${label} \u00b7 BUILD ${stamp} \u2014 ${SITE}`);
