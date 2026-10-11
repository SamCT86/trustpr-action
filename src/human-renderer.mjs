import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';

export const RENDERER_VERSION = 'TRUSTPR-MD-V1';
export const RENDER_LIMITS = Object.freeze({
  maxStringCodePoints: 512,
  maxListItems: 50,
  maxReasons: 50,
  maxOutputBytes: 65536
});

const RECEIPT_SCHEMA_VERSION = 'trustpr-receipt-v1';
const VALIDITY_STATES = new Set(['INVALID', 'STALE', 'PARTIAL', 'VALID']);
const CORE_KEYS = Object.freeze([
  'declared', 'inferred', 'observed', 'snapshot_identity',
  'subject', 'unknowns', 'validity'
]);
const SUBJECT_KEYS = Object.freeze([
  'base_commit_sha', 'head_commit_sha', 'merge_base_sha',
  'pull_request_number', 'repository_id'
]);

class RenderError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'TrustPrRenderError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RenderError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sameKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, i) => key === expected[i]);
}

function assertUnicodeScalars(value) {
  if (typeof value !== 'string') fail('INVALID_STRING', 'Expected string');
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) fail('INVALID_UNICODE', 'Lone high surrogate');
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) fail('INVALID_UNICODE', 'Lone high surrogate');
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('INVALID_UNICODE', 'Lone low surrogate');
    }
  }
}

function canonicalize(value, depth = 0) {
  if (depth > 64) fail('CANONICALIZATION_DEPTH_EXCEEDED');
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertUnicodeScalars(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      fail('UNSAFE_CANONICAL_NUMBER');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalize(item, depth + 1)).join(',') + ']';
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      assertUnicodeScalars(key);
      if (value[key] === undefined) fail('UNDEFINED_CANONICAL_VALUE');
    }
    return '{' + keys.map(
      (key) => JSON.stringify(key) + ':' + canonicalize(value[key], depth + 1)
    ).join(',') + '}';
  }
  fail('NON_JCS_VALUE');
}

export function computeCoreDigest(core) {
  const bytes = Buffer.from(canonicalize(core), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertReceiptForRender(receipt) {
  if (!isPlainObject(receipt)) fail('INVALID_RECEIPT');
  if (receipt.receipt_schema_version !== RECEIPT_SCHEMA_VERSION) {
    fail('UNSUPPORTED_RECEIPT_SCHEMA');
  }
  if (!isPlainObject(receipt.integrity)) fail('INVALID_INTEGRITY');
  if (receipt.integrity.algorithm !== 'sha256') {
    fail('UNSUPPORTED_INTEGRITY_ALGORITHM');
  }
  if (
    typeof receipt.integrity.core_digest !== 'string'
    || !/^[0-9a-f]{64}$/.test(receipt.integrity.core_digest)
  ) {
    fail('INVALID_CORE_DIGEST');
  }
  if (receipt.authenticity !== 'UNAUTHENTICATED') {
    fail('AUTHENTICITY_NOT_SUPPORTED');
  }
  if (!sameKeys(receipt.core, CORE_KEYS)) fail('INVALID_CORE_SHAPE');
  if (!sameKeys(receipt.core.subject, SUBJECT_KEYS)) fail('INVALID_SUBJECT_SHAPE');

  for (const key of SUBJECT_KEYS) {
    if (typeof receipt.core.subject[key] !== 'string') fail('INVALID_SUBJECT_FIELD');
    assertUnicodeScalars(receipt.core.subject[key]);
  }
  if (typeof receipt.core.snapshot_identity !== 'string') fail('INVALID_SNAPSHOT_IDENTITY');
  assertUnicodeScalars(receipt.core.snapshot_identity);

  if (!isPlainObject(receipt.core.declared)) fail('INVALID_DECLARED');
  if (receipt.core.declared.policy_binding !== 'POLICY_UNBOUND') {
    fail('POLICY_BINDING_NOT_SUPPORTED');
  }
  if (!Array.isArray(receipt.core.declared.required_evidence)) {
    fail('INVALID_REQUIRED_EVIDENCE');
  }
  if (!isPlainObject(receipt.core.observed)) fail('INVALID_OBSERVED');
  for (const key of ['changed_entries', 'checks', 'artifacts']) {
    if (!Array.isArray(receipt.core.observed[key])) fail('INVALID_OBSERVED_COLLECTION');
  }
  if (!Array.isArray(receipt.core.inferred) || !Array.isArray(receipt.core.unknowns)) {
    fail('INVALID_FINDING_COLLECTION');
  }
  if (!isPlainObject(receipt.core.validity)) fail('INVALID_VALIDITY');
  if (!VALIDITY_STATES.has(receipt.core.validity.status)) fail('INVALID_VALIDITY_STATUS');
  if (!Array.isArray(receipt.core.validity.reasons)) fail('INVALID_VALIDITY_REASONS');

  const actualDigest = computeCoreDigest(receipt.core);
  if (actualDigest !== receipt.integrity.core_digest) {
    fail('CORE_DIGEST_MISMATCH');
  }
}

function resolveLimits(options) {
  if (options === undefined || options === null) return { ...RENDER_LIMITS };
  if (!isPlainObject(options)) fail('RENDER_OPTIONS_FORBIDDEN');
  if (Object.keys(options).length > 0) fail('RENDER_OPTIONS_FORBIDDEN');
  return { ...RENDER_LIMITS };
}

function isDangerousFormatCodePoint(code) {
  return code === 0x00ad
    || code === 0x034f
    || code === 0x061c
    || (code >= 0x200b && code <= 0x200f)
    || (code >= 0x202a && code <= 0x202e)
    || (code >= 0x2060 && code <= 0x206f)
    || code === 0xfeff
    || code === 0xe0001
    || (code >= 0xe0020 && code <= 0xe007f);
}

function visibleEscape(code) {
  if (code <= 0xffff) return '\\u' + code.toString(16).padStart(4, '0');
  return '\\u{' + code.toString(16) + '}';
}

function neutralizeControls(value) {
  let out = '';
  for (let i = 0; i < value.length;) {
    const first = value.charCodeAt(i);
    if (first >= 0xd800 && first <= 0xdbff) {
      if (i + 1 >= value.length) {
        out += visibleEscape(first);
        i += 1;
        continue;
      }
      const second = value.charCodeAt(i + 1);
      if (second < 0xdc00 || second > 0xdfff) {
        out += visibleEscape(first);
        i += 1;
        continue;
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      out += visibleEscape(first);
      i += 1;
      continue;
    }

    const code = value.codePointAt(i);
    const width = code > 0xffff ? 2 : 1;
    if (
      code <= 0x1f
      || (code >= 0x7f && code <= 0x9f)
      || isDangerousFormatCodePoint(code)
    ) {
      out += visibleEscape(code);
    } else {
      out += String.fromCodePoint(code);
    }
    i += width;
  }
  return out;
}

function htmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function markdownEscape(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/([\`*_{}\[\]()#+.!|>~-])/g, '\\$1');
}

function safeInline(value, field, limits, findings) {
  if (typeof value !== 'string') value = canonicalize(value);
  const points = Array.from(value);
  let raw = value;
  if (points.length > limits.maxStringCodePoints) {
    const omitted = points.length - limits.maxStringCodePoints;
    raw = points.slice(0, limits.maxStringCodePoints).join('');
    findings.push({
      code: 'RENDER_TRUNCATED',
      field,
      observed: points.length,
      cap: limits.maxStringCodePoints
    });
    return markdownEscape(htmlEscape(neutralizeControls(raw)))
      + `…\\[truncated ${omitted} code points\\]`;
  }
  return markdownEscape(htmlEscape(neutralizeControls(raw)));
}

function boundedItems(items, field, cap, findings) {
  if (items.length <= cap) return items;
  findings.push({
    code: 'RENDER_LIST_TRUNCATED',
    field,
    observed: items.length,
    cap
  });
  return items.slice(0, cap);
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length === 0) fail('INVALID_RAW_PATH_B64');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('INVALID_RAW_PATH_B64');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) fail('INVALID_RAW_PATH_B64');
  return bytes;
}

function renderGitPath(rawPathB64, limits, findings, field) {
  const bytes = decodeCanonicalBase64(rawPathB64);
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return safeInline(decoded, field, limits, findings);
  } catch {
    const display = `[non-UTF8 path: base64:${rawPathB64}]`;
    return safeInline(display, field, limits, findings);
  }
}

function renderReason(reason, index, limits, findings) {
  if (!isPlainObject(reason)) fail('INVALID_VALIDITY_REASON');
  const serialized = canonicalize(reason);
  return safeInline(serialized, `validity.reasons[${index}]`, limits, findings);
}

function renderFindingRecord(record, field, index, limits, findings) {
  if (!isPlainObject(record)) fail('INVALID_FINDING_RECORD');
  const code = record.stable_code ?? record.code ?? 'UNSPECIFIED';
  const source = record.field_or_source_tuple ?? record.field ?? record.source_ref ?? '';
  return [
    safeInline(code, `${field}[${index}].code`, limits, findings),
    safeInline(source, `${field}[${index}].source`, limits, findings)
  ];
}

function renderLines(receipt, limits) {
  const core = receipt.core;
  const findings = [];
  const lines = [];

  lines.push('# TrustPR evidence receipt');
  lines.push('');
  lines.push(`- Renderer: ${safeInline(RENDERER_VERSION, 'renderer_version', limits, findings)}`);
  lines.push(`- Receipt schema: ${safeInline(receipt.receipt_schema_version, 'receipt_schema_version', limits, findings)}`);
  lines.push(`- Core digest: ${receipt.integrity.core_digest}`);
  lines.push(`- Status: ${core.validity.status}`);
  lines.push(`- Authenticity: ${safeInline(receipt.authenticity, 'authenticity', limits, findings)}`);
  lines.push(`- Policy: ${safeInline(core.declared.policy_binding, 'declared.policy_binding', limits, findings)}`);
  lines.push('- Safety boundary: VALID does not mean safe to merge; TrustPR V1 is evidence-only and POLICY_UNBOUND.');
  lines.push('');

  lines.push('## Subject');
  for (const key of SUBJECT_KEYS) {
    lines.push(`- ${safeInline(key, 'subject.field', limits, findings)}: ${safeInline(core.subject[key], `subject.${key}`, limits, findings)}`);
  }
  lines.push(`- snapshot_identity: ${safeInline(core.snapshot_identity, 'snapshot_identity', limits, findings)}`);
  lines.push('');

  lines.push('## Reasons');
  const reasons = boundedItems(
    core.validity.reasons,
    'validity.reasons',
    limits.maxReasons,
    findings
  );
  if (reasons.length === 0) {
    lines.push('- none');
  } else {
    reasons.forEach((reason, index) => {
      lines.push(`- ${renderReason(reason, index, limits, findings)}`);
    });
  }
  lines.push('');

  lines.push('## Evidence counts');
  lines.push(`- changed_entries: ${core.observed.changed_entries.length}`);
  lines.push(`- checks: ${core.observed.checks.length}`);
  lines.push(`- artifacts: ${core.observed.artifacts.length}`);
  lines.push(`- unknowns: ${core.unknowns.length}`);
  lines.push(`- inferred: ${core.inferred.length}`);
  lines.push('');

  lines.push('## Changed entries');
  const changed = boundedItems(
    core.observed.changed_entries,
    'changed_entries',
    limits.maxListItems,
    findings
  );
  if (changed.length === 0) {
    lines.push('- none');
  } else {
    changed.forEach((entry, index) => {
      if (!isPlainObject(entry) || typeof entry.raw_path_b64 !== 'string') {
        fail('INVALID_CHANGED_ENTRY');
      }
      const path = renderGitPath(
        entry.raw_path_b64,
        limits,
        findings,
        `changed_entries[${index}].raw_path_b64`
      );
      const type = safeInline(
        entry.change_type ?? 'UNKNOWN',
        `changed_entries[${index}].change_type`,
        limits,
        findings
      );
      lines.push(`- ${path} — ${type}`);
    });
  }
  lines.push('');

  lines.push('## Checks');
  const checks = boundedItems(core.observed.checks, 'checks', limits.maxListItems, findings);
  if (checks.length === 0) {
    lines.push('- none');
  } else {
    checks.forEach((check, index) => {
      if (!isPlainObject(check)) fail('INVALID_CHECK_RECORD');
      const provider = safeInline(check.provider ?? 'UNKNOWN', `checks[${index}].provider`, limits, findings);
      const id = safeInline(check.check_run_id ?? 'UNKNOWN', `checks[${index}].check_run_id`, limits, findings);
      const status = safeInline(check.status ?? 'UNKNOWN', `checks[${index}].status`, limits, findings);
      const conclusion = safeInline(check.conclusion ?? 'UNKNOWN', `checks[${index}].conclusion`, limits, findings);
      lines.push(`- provider=${provider} check_run_id=${id} status=${status} conclusion=${conclusion}`);
    });
  }
  lines.push('');

  lines.push('## Artifacts');
  const artifacts = boundedItems(core.observed.artifacts, 'artifacts', limits.maxListItems, findings);
  if (artifacts.length === 0) {
    lines.push('- none');
  } else {
    artifacts.forEach((artifact, index) => {
      if (!isPlainObject(artifact)) fail('INVALID_ARTIFACT_RECORD');
      const provider = safeInline(artifact.provider ?? 'UNKNOWN', `artifacts[${index}].provider`, limits, findings);
      const id = safeInline(artifact.artifact_id ?? 'UNKNOWN', `artifacts[${index}].artifact_id`, limits, findings);
      lines.push(`- provider=${provider} artifact_id=${id}`);
    });
  }
  lines.push('');

  for (const [heading, field, values] of [
    ['Unknowns', 'unknowns', core.unknowns],
    ['Inferred', 'inferred', core.inferred]
  ]) {
    lines.push(`## ${heading}`);
    const items = boundedItems(values, field, limits.maxListItems, findings);
    if (items.length === 0) {
      lines.push('- none');
    } else {
      items.forEach((record, index) => {
        const [code, source] = renderFindingRecord(record, field, index, limits, findings);
        lines.push(`- ${code}${source ? ` — ${source}` : ''}`);
      });
    }
    lines.push('');
  }

  if (findings.length > 0) {
    lines.push('## Renderer findings');
    for (const finding of findings) {
      const parts = [
        safeInline(finding.code, 'renderer_finding.code', limits, []),
        safeInline(finding.field, 'renderer_finding.field', limits, [])
      ];
      if (finding.observed !== undefined) parts.push(`observed=${finding.observed}`);
      if (finding.cap !== undefined) parts.push(`cap=${finding.cap}`);
      lines.push('- ' + parts.join(' '));
    }
    lines.push('');
  }

  return lines;
}

export function renderTrustPrMarkdown(receipt, options = {}) {
  assertReceiptForRender(receipt);
  const limits = resolveLimits(options);
  const output = renderLines(receipt, limits).join('\n') + '\n';
  const size = Buffer.byteLength(output, 'utf8');
  if (size > limits.maxOutputBytes) {
    fail(
      'RENDER_OUTPUT_LIMIT_EXCEEDED',
      `Rendered output ${size} bytes exceeds cap ${limits.maxOutputBytes}`
    );
  }
  return output;
}

export function renderTrustPrMarkdownBytes(receipt, options = {}) {
  return Buffer.from(renderTrustPrMarkdown(receipt, options), 'utf8');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function verifyTrustPrMarkdown(receipt, suppliedSummary, options = {}) {
  const expected = renderTrustPrMarkdownBytes(receipt, options);
  let supplied;

  if (typeof suppliedSummary === 'string') {
    supplied = Buffer.from(suppliedSummary, 'utf8');
  } else if (Buffer.isBuffer(suppliedSummary) || suppliedSummary instanceof Uint8Array) {
    supplied = Buffer.from(suppliedSummary);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(supplied);
    } catch {
      return {
        status: 'MISMATCH',
        finding: { code: 'SUPPLIED_SUMMARY_INVALID_UTF8' },
        expected_sha256: sha256(expected),
        supplied_sha256: sha256(supplied)
      };
    }
  } else {
    fail('INVALID_SUPPLIED_SUMMARY');
  }

  if (expected.equals(supplied)) {
    return {
      status: 'MATCH',
      expected_sha256: sha256(expected),
      supplied_sha256: sha256(supplied)
    };
  }
  return {
    status: 'MISMATCH',
    finding: { code: 'HUMAN_SUMMARY_MISMATCH' },
    expected_sha256: sha256(expected),
    supplied_sha256: sha256(supplied)
  };
}
