/**
 * Cryptography for the account service.
 *
 * Everything here uses WebCrypto (`globalThis.crypto`), which exists in Workers
 * and in the Node used by the test suite. No dependency, no hand-rolled cipher:
 * the primitives are random bytes, SHA-256, HMAC-SHA256 and RSASSA-PKCS1-v1_5
 * verification for Google's ID token.
 */

const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64urlEncode(buffer);
}

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let index = 0; index < bytes.length; index++) out += bytes[index].toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function sha256Base64url(value: string): Promise<string> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function hmacSha256Base64url(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message));
  return base64urlEncode(new Uint8Array(signature));
}

export async function hmacSha256Verify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64urlDecode(signature);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, encoder.encode(message));
}

/** Constant-time string comparison for secrets of arbitrary length. */
export function safeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  // Length is not secret in these comparisons (both are fixed-size tokens), but
  // comparing all bytes of the longer input keeps timing independent of content.
  let difference = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/** PKCE S256: the challenge is the base64url SHA-256 of the verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return sha256Base64url(verifier);
}

export interface JwkKey {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

/**
 * Verify an RS256 JWT signature and return the decoded payload.
 *
 * Only RS256 is accepted, and only with a key supplied by the caller's key set:
 * an ID token that names `alg: none`, a symmetric algorithm, or a key id the
 * provider does not publish is rejected before any claim is looked at.
 */
export async function verifyRs256Jwt(
  token: string,
  keys: readonly JwkKey[],
): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerPart))) as Record<string, unknown>;
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart))) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;
  const kid = typeof header.kid === 'string' ? header.kid : null;
  const candidates = keys.filter(
    (key) => key.kty === 'RSA' && key.n && key.e && (kid === null || key.kid === kid),
  );
  if (candidates.length === 0) return null;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = base64urlDecode(signaturePart);
  } catch {
    return null;
  }
  const signed = encoder.encode(`${headerPart}.${payloadPart}`);
  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed);
      if (valid) return payload;
    } catch {
      /* try the next published key */
    }
  }
  return null;
}
