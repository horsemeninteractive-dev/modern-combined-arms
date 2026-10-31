/**
 * Which browser origins may reach the room worker.
 *
 * Shared by the Worker's CORS grant and the room's socket check so the two can
 * never disagree: a page that may POST a room action must also be able to open
 * the seat socket, and neither may admit an origin the other refuses.
 *
 * Entries are exact origins (`https://game.example`) or one-label wildcards
 * (`https://*.example.com`), which cover a project's preview deployments
 * without trusting an unrelated host. Wildcards match a subdomain label and
 * nothing else: no port, no path, no extra labels.
 */

/** `https://*.example.com` → a matcher for one label under that exact host. */
function matchesWildcard(entry: string, origin: string): boolean {
  const star = entry.indexOf('*');
  if (star === -1) return false;
  if (entry.indexOf('*', star + 1) !== -1) return false;
  const prefix = entry.slice(0, star);
  const suffix = entry.slice(star + 1);
  if (!origin.startsWith(prefix) || !origin.endsWith(suffix)) return false;
  const label = origin.slice(prefix.length, origin.length - suffix.length);
  return label.length > 0 && /^[a-z0-9][a-z0-9-]*$/i.test(label);
}

/** True when an exact origin, or one allowlisted entry, admits this origin. */
export function originPermitted(origin: string, allowed: string | undefined): boolean {
  const entries = String(allowed ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (entry === origin) return true;
    if (matchesWildcard(entry, origin)) return true;
  }
  return false;
}
