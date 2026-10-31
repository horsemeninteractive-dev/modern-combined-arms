import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';

const raw = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

interface Rule {
  path: string;
  headers: Map<string, string>;
}

function parseRules(source: string): Rule[] {
  const rules: Rule[] = [];
  let current: Rule | null = null;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { path: trimmed, headers: new Map() };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    current.headers.set(
      line.slice(0, colon).trim().toLowerCase(),
      line.slice(colon + 1).trim(),
    );
  }
  return rules;
}

function rule(path: string): Rule {
  const found = parseRules(raw).find((entry) => entry.path === path);
  if (!found) throw new Error(`_headers is missing the ${path} rule`);
  return found;
}

describe('Pages security header policy', () => {
  it('locks the shell to same-origin scripts and frames', () => {
    const headers = rule('/*').headers;
    const csp = headers.get('content-security-policy');
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain('wss://moderncombinedarms.pages.dev');
    expect(csp).toContain('wss://*.moderncombinedarms.pages.dev');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('upgrade-insecure-requests');

    expect(headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('permissions-policy')).toContain('camera=()');
    expect(headers.get('permissions-policy')).toContain('microphone=()');
    expect(headers.get('permissions-policy')).toContain('geolocation=()');
  });

  it('marks API responses as non-cacheable, cookie-varied and same-origin', () => {
    const headers = rule('/api/*').headers;
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('pragma')).toBe('no-cache');
    expect(headers.get('vary')).toContain('Cookie');
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('does not allow a wildcard CORS origin in the policy', () => {
    expect(raw).not.toMatch(/Access-Control-Allow-Origin:\s*\*/i);
  });

  it('keeps the manifest MIME and service-worker revalidation rules', () => {
    expect(rule('/manifest.webmanifest').headers.get('content-type')).toBe(
      'application/manifest+json',
    );
    expect(rule('/sw.js').headers.get('cache-control')).toContain('must-revalidate');
  });

  it('keeps the document free of inline script handlers that the CSP would block', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(main).not.toContain('onclick="');
    expect(main).toContain('fatal-reload');
    expect(main).toContain("addEventListener('click'");
  });
});
