import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';

export const ARTIFACT_BYTES_VERSION = 'TRUSTPR-ARTIFACT-BYTES-V1';
export const ARCHIVE_MANIFEST_VERSION = 'TRUSTPR-ARCHIVE-MANIFEST-V1';
export const ARTIFACT_LIMITS = Object.freeze({
  maxArchiveBytes: 268435456,
  maxMemberBytes: 67108864,
  maxMembers: 1000,
  maxPathBytes: 4096,
  maxRedirects: 8
});

// Archive paths are byte identities: a leading BOM is part of the filename.
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const SHA256_RE = /^sha256:([0-9a-fA-F]{64})$/;
const DECIMAL_RE = /^(?:0|[1-9][0-9]*)$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function parseDecimal(value) {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('unsafe number');
    return String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort().map(
      (key) => JSON.stringify(key) + ':' + canonicalJson(value[key])
    ).join(',') + '}';
  }
  throw new TypeError('unsupported canonical JSON value');
}

function invalid(reason, extra = {}) {
  return { status: 'INVALID', reason, ...extra };
}

function partial(reason, extra = {}) {
  return { status: 'PARTIAL', reason, ...extra };
}

export function verifyArtifactBytes(artifact, bytesInput, context = {}) {
  if (!isPlainObject(artifact)) return invalid('ARTIFACT_METADATA_INVALID');
  const provider = artifact.provider;
  const artifactId = artifact.artifact_id;
  if (typeof provider !== 'string' || provider.length === 0
      || typeof artifactId !== 'string' || artifactId.length === 0) {
    return invalid('ARTIFACT_IDENTITY_INVALID');
  }

  if (String(artifact.retention_state ?? '').toLowerCase() !== 'available') {
    return partial('ARTIFACT_UNAVAILABLE', {
      provider, artifact_id: artifactId, content_sha256: null,
      content_length: null, provider_digest_state: 'NOT_CHECKED',
      authenticity: 'UNAUTHENTICATED'
    });
  }

  const bytes = toBytes(bytesInput);
  if (!bytes) {
    return partial('ARTIFACT_BYTES_UNAVAILABLE', {
      provider, artifact_id: artifactId, content_sha256: null,
      content_length: null, provider_digest_state: 'NOT_CHECKED',
      authenticity: 'UNAUTHENTICATED'
    });
  }
  if (bytes.length > ARTIFACT_LIMITS.maxArchiveBytes) {
    return invalid('ARTIFACT_BYTE_SIZE_LIMIT_EXCEEDED', {
      provider, artifact_id: artifactId,
      content_length: String(bytes.length), content_sha256: null,
      provider_digest_state: 'NOT_CHECKED', authenticity: 'UNAUTHENTICATED'
    });
  }

  const length = String(bytes.length);
  const contentLength = context?.contentLength;
  if (contentLength !== undefined && contentLength !== null) {
    const parsed = parseDecimal(contentLength);
    if (parsed === null) return invalid('ARTIFACT_CONTENT_LENGTH_INVALID');
    if (parsed !== BigInt(bytes.length)) {
      return invalid('ARTIFACT_CONTENT_LENGTH_MISMATCH', {
        provider, artifact_id: artifactId,
        content_length: length, observed_content_length_header: contentLength,
        content_sha256: sha256(bytes), provider_digest_state: 'NOT_CHECKED',
        authenticity: 'UNAUTHENTICATED'
      });
    }
  }

  if (artifact.reported_size !== undefined && artifact.reported_size !== null) {
    const reported = parseDecimal(artifact.reported_size);
    if (reported === null) return invalid('ARTIFACT_REPORTED_SIZE_INVALID');
    if (reported !== BigInt(bytes.length)) {
      return invalid('ARTIFACT_REPORTED_SIZE_MISMATCH', {
        provider, artifact_id: artifactId,
        content_length: length, reported_size: artifact.reported_size,
        content_sha256: sha256(bytes), provider_digest_state: 'NOT_CHECKED',
        authenticity: 'UNAUTHENTICATED'
      });
    }
  }

  const localDigest = sha256(bytes);
  const supplied = artifact.provider_digest;
  let providerDigestState = 'NOT_SUPPLIED';
  let status = 'VALID';
  let reason;

  if (supplied !== undefined && supplied !== null) {
    if (typeof supplied !== 'string') {
      status = 'PARTIAL';
      providerDigestState = 'UNSUPPORTED';
      reason = 'PROVIDER_DIGEST_UNSUPPORTED';
    } else {
      const match = SHA256_RE.exec(supplied);
      if (!match) {
        status = 'PARTIAL';
        providerDigestState = 'UNSUPPORTED';
        reason = 'PROVIDER_DIGEST_UNSUPPORTED';
      } else if (match[1].toLowerCase() !== localDigest) {
        return invalid('ARTIFACT_DIGEST_MISMATCH', {
          provider, artifact_id: artifactId, content_sha256: localDigest,
          content_length: length, provider_digest: supplied.toLowerCase(),
          provider_digest_state: 'MISMATCH', authenticity: 'UNAUTHENTICATED'
        });
      } else {
        providerDigestState = 'MATCH';
      }
    }
  }

  return {
    status,
    ...(reason ? { reason } : {}),
    provider,
    artifact_id: artifactId,
    content_sha256: localDigest,
    content_length: length,
    provider_digest: supplied ?? null,
    provider_digest_state: providerDigestState,
    authenticity: 'UNAUTHENTICATED'
  };
}

export function classifyArtifactRetrievalFailure(input) {
  const kind = isPlainObject(input) ? input.kind : null;
  if (kind === 'digest_mismatch' || kind === 'identity_mismatch') {
    return { status: 'INVALID', reason: kind === 'digest_mismatch'
      ? 'ARTIFACT_DIGEST_MISMATCH' : 'ARTIFACT_IDENTITY_MISMATCH', retryable: false };
  }
  if (['timeout', 'network', 'rate_limit', 'server_error'].includes(kind)) {
    return { status: 'PARTIAL', reason: 'ARTIFACT_RETRIEVAL_TRANSIENT', retryable: true };
  }
  if (['not_found', 'deleted', 'expired'].includes(kind)) {
    return { status: 'PARTIAL', reason: 'ARTIFACT_UNRETRIEVABLE', retryable: false };
  }
  if (kind === 'permission_denied') {
    return { status: 'PARTIAL', reason: 'ARTIFACT_RETRIEVAL_PERMISSION_DENIED', retryable: false };
  }
  return { status: 'PARTIAL', reason: 'ARTIFACT_RETRIEVAL_UNKNOWN', retryable: false };
}

function parsePolicyOrigin(text) {
  if (typeof text !== 'string' || text === '*' || text.length === 0) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
        || url.pathname !== '/' || url.search) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parsePathPrefixes(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = [];
  for (const prefix of value) {
    if (typeof prefix !== 'string' || !prefix.startsWith('/') || prefix.includes('\\')) return null;
    let url;
    try { url = new URL(prefix, 'https://policy.invalid'); } catch { return null; }
    if (url.origin !== 'https://policy.invalid' || url.search || url.hash || url.pathname !== prefix) return null;
    out.push(prefix);
  }
  return new Set(out).size === out.length ? out : null;
}

function pathAllowed(path, prefixes) {
  return prefixes.some((prefix) => prefix === '/'
    || path === prefix
    || (prefix.endsWith('/') ? path.startsWith(prefix) : path.startsWith(prefix + '/')));
}

function rawPathFromUrlText(text) {
  const scheme = text.indexOf('://');
  if (scheme < 0) return null;
  const authorityStart = scheme + 3;
  const query = text.indexOf('?', authorityStart);
  const fragment = text.indexOf('#', authorityStart);
  const candidates = [query, fragment].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : text.length;
  const slash = text.indexOf('/', authorityStart);
  if (slash < 0 || slash >= end) return '/';
  return text.slice(slash, end);
}

function pathEncodingSafe(path) {
  if (path.includes('\\')) return false;
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] !== '%') continue;
    const hex = path.slice(i + 1, i + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return false;
    const byte = Number.parseInt(hex, 16);
    if (byte <= 0x1f || byte === 0x7f
        || byte === 0x25 || byte === 0x2e || byte === 0x2f || byte === 0x5c) {
      return false;
    }
    i += 2;
  }
  return true;
}

function safeHop(text) {
  if (typeof text !== 'string') return { error: 'REDIRECT_URL_INVALID' };
  let url;
  try { url = new URL(text); } catch { return { error: 'REDIRECT_URL_INVALID' }; }
  if (url.protocol !== 'https:') return { error: 'REDIRECT_SCHEME_FORBIDDEN' };
  if (url.username || url.password) return { error: 'REDIRECT_USERINFO_FORBIDDEN' };
  if (url.hash) return { error: 'REDIRECT_FRAGMENT_FORBIDDEN' };
  const rawPath = rawPathFromUrlText(text);
  if (rawPath === null || !pathEncodingSafe(rawPath)) {
    return { error: 'REDIRECT_PATH_ENCODING_FORBIDDEN' };
  }
  return {
    origin: url.origin,
    path: url.pathname,
    // Intentionally omit query/search: signed redirect credentials are never reflected.
  };
}

export function validateArtifactRedirectChain(chain, policy) {
  if (!Array.isArray(chain) || chain.length === 0) return invalid('REDIRECT_CHAIN_INVALID');
  if (chain.length > ARTIFACT_LIMITS.maxRedirects) return invalid('REDIRECT_LIMIT_EXCEEDED');
  if (!isPlainObject(policy)) return invalid('REDIRECT_POLICY_INVALID');
  const initialOrigin = parsePolicyOrigin(policy.initialOrigin);
  const initialPrefixes = parsePathPrefixes(policy.initialPathPrefixes);
  if (!initialOrigin || !initialPrefixes || !Array.isArray(policy.approvedRedirects)) {
    return invalid('REDIRECT_POLICY_INVALID');
  }

  const approved = [];
  for (const rule of policy.approvedRedirects) {
    if (!isPlainObject(rule)) return invalid('REDIRECT_POLICY_INVALID');
    const origin = parsePolicyOrigin(rule.origin);
    const pathPrefixes = parsePathPrefixes(rule.pathPrefixes);
    if (!origin || !pathPrefixes) return invalid('REDIRECT_POLICY_INVALID');
    approved.push({ origin, pathPrefixes });
  }
  const ruleKeys = approved.map((rule) => JSON.stringify([rule.origin, rule.pathPrefixes]));
  if (new Set(ruleKeys).size !== ruleKeys.length) return invalid('REDIRECT_POLICY_INVALID');

  const hops = [];
  for (let i = 0; i < chain.length; i += 1) {
    const hop = safeHop(chain[i]);
    if (hop.error) return invalid(hop.error);
    if (i === 0) {
      if (hop.origin !== initialOrigin) return invalid('REDIRECT_INITIAL_ORIGIN_MISMATCH');
      if (!pathAllowed(hop.path, initialPrefixes)) return invalid('REDIRECT_PATH_FORBIDDEN');
    } else {
      const rules = approved.filter((rule) => rule.origin === hop.origin);
      if (rules.length === 0) return invalid('REDIRECT_ORIGIN_FORBIDDEN');
      if (!rules.some((rule) => pathAllowed(hop.path, rule.pathPrefixes))) {
        return invalid('REDIRECT_PATH_FORBIDDEN');
      }
    }
    hops.push({ origin: hop.origin, path: hop.path });
  }
  return { status: 'VALID', hops };
}

function canonicalBase64Decode(value) {
  if (typeof value !== 'string' || value.length === 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) return null;
  return bytes;
}

function archivePathCheck(raw) {
  if (raw.length > ARTIFACT_LIMITS.maxPathBytes) {
    return { error: 'ARCHIVE_PATH_LENGTH_EXCEEDED' };
  }
  let path;
  try { path = UTF8_FATAL.decode(raw); } catch { return { error: 'ARCHIVE_PATH_INVALID_UTF8' }; }
  if (path.length === 0) return { error: 'ARCHIVE_PATH_EMPTY' };
  for (const ch of path) {
    const cp = ch.codePointAt(0);
    if (cp === 0 || cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) {
      return { error: 'ARCHIVE_PATH_CONTROL_FORBIDDEN' };
    }
  }
  if (path.startsWith('/') || path.startsWith('//')) return { error: 'ARCHIVE_PATH_ABSOLUTE_FORBIDDEN' };
  if (/^[A-Za-z]:/.test(path)) return { error: 'ARCHIVE_PATH_DRIVE_FORBIDDEN' };
  if (path.includes('\\')) return { error: 'ARCHIVE_PATH_BACKSLASH_FORBIDDEN' };

  const trailing = path.endsWith('/');
  const body = trailing ? path.slice(0, -1) : path;
  if (!body) return { error: 'ARCHIVE_PATH_EMPTY' };
  const parts = body.split('/');
  if (parts.some((part) => part === '')) return { error: 'ARCHIVE_PATH_EMPTY_COMPONENT' };
  if (parts.some((part) => part === '.' || part === '..')) return { error: 'ARCHIVE_PATH_DOT_SEGMENT_FORBIDDEN' };
  if (path.normalize('NFC') !== path) return { error: 'ARCHIVE_PATH_NON_NFC' };
  return { path, trailing };
}

function compareBuffers(a, b) {
  return Buffer.compare(a, b);
}

export function buildSafeArchiveManifest(entries) {
  if (!Array.isArray(entries)) return invalid('ARCHIVE_ENTRIES_INVALID');
  if (entries.length > ARTIFACT_LIMITS.maxMembers) {
    return invalid('ARCHIVE_MEMBER_COUNT_LIMIT_EXCEEDED');
  }

  const preflight = [];
  const seenRaw = new Set();
  const seenLogicalKinds = new Map();
  const fileLogicalPaths = new Set();
  let total = 0n;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!isPlainObject(entry)) return invalid('ARCHIVE_MEMBER_INVALID');
    if (!['file', 'directory'].includes(entry.kind)) {
      return invalid('ARCHIVE_MEMBER_KIND_FORBIDDEN');
    }

    const raw = canonicalBase64Decode(entry.raw_path_b64);
    if (!raw) return invalid('ARCHIVE_PATH_BASE64_INVALID');
    const checked = archivePathCheck(raw);
    if (checked.error) return invalid(checked.error);
    if ((entry.kind === 'file' && checked.trailing)
        || (entry.kind === 'directory' && !checked.trailing)) {
      return invalid('ARCHIVE_PATH_KIND_MISMATCH');
    }

    const rawKey = raw.toString('base64');
    if (seenRaw.has(rawKey)) return invalid('ARCHIVE_DUPLICATE_PATH');
    seenRaw.add(rawKey);

    const logicalPath = checked.trailing ? checked.path.slice(0, -1) : checked.path;
    const existingKind = seenLogicalKinds.get(logicalPath);
    if (existingKind) {
      return invalid(existingKind !== entry.kind
        ? 'ARCHIVE_PATH_TYPE_CONFLICT' : 'ARCHIVE_DUPLICATE_PATH');
    }
    for (const filePath of fileLogicalPaths) {
      if (logicalPath.startsWith(filePath + '/')) {
        return invalid('ARCHIVE_PATH_ANCESTOR_FILE_CONFLICT');
      }
    }
    if (entry.kind === 'file') {
      for (const priorPath of seenLogicalKinds.keys()) {
        if (priorPath.startsWith(logicalPath + '/')) {
          return invalid('ARCHIVE_PATH_ANCESTOR_FILE_CONFLICT');
        }
      }
      fileLogicalPaths.add(logicalPath);
    }
    seenLogicalKinds.set(logicalPath, entry.kind);

    const size = parseDecimal(entry.uncompressed_size);
    if (size === null) return invalid('ARCHIVE_MEMBER_SIZE_INVALID');
    if (entry.kind === 'directory' && size !== 0n) return invalid('ARCHIVE_DIRECTORY_SIZE_INVALID');
    if (size > BigInt(ARTIFACT_LIMITS.maxMemberBytes)) {
      return invalid('ARCHIVE_MEMBER_SIZE_LIMIT_EXCEEDED');
    }
    total += size;
    if (total > BigInt(ARTIFACT_LIMITS.maxArchiveBytes)) {
      return invalid('ARCHIVE_TOTAL_SIZE_LIMIT_EXCEEDED');
    }

    preflight.push({ entry, raw, displayPath: checked.path, size });
  }

  const members = [];
  for (const item of preflight) {
    const { entry, raw, displayPath, size } = item;
    if (entry.kind === 'directory') {
      if (entry.bytes !== undefined && toBytes(entry.bytes)?.length !== 0) {
        return invalid('ARCHIVE_DIRECTORY_BYTES_FORBIDDEN');
      }
      members.push({
        raw_path_b64: raw.toString('base64'),
        display_path: displayPath,
        kind: 'directory',
        uncompressed_size: '0',
        sha256: null
      });
      continue;
    }
    const bytes = toBytes(entry.bytes);
    if (!bytes) return invalid('ARCHIVE_MEMBER_BYTES_UNAVAILABLE');
    if (BigInt(bytes.length) !== size) return invalid('ARCHIVE_MEMBER_SIZE_MISMATCH');
    members.push({
      raw_path_b64: raw.toString('base64'),
      display_path: displayPath,
      kind: 'file',
      uncompressed_size: String(size),
      sha256: sha256(bytes)
    });
  }

  members.sort((a, b) => compareBuffers(
    Buffer.from(a.raw_path_b64, 'base64'),
    Buffer.from(b.raw_path_b64, 'base64')
  ));
  const manifestCore = {
    manifest_version: ARCHIVE_MANIFEST_VERSION,
    members
  };
  return {
    status: 'VALID',
    manifest_version: ARCHIVE_MANIFEST_VERSION,
    member_count: String(members.length),
    total_uncompressed_size: String(total),
    members,
    manifest_sha256: sha256(Buffer.from(canonicalJson(manifestCore), 'utf8'))
  };
}
