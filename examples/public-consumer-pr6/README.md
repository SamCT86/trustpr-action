# Archived first-party TrustPR v0.1.1 consumer receipt

This directory preserves the **exact original bytes** of two files from a real, maintainer-controlled, public GitHub Actions run. It exists because GitHub's original seven-day artifact expires on 27 October 2026. It is a durable example, **not** third-party adoption, a cryptographically authenticated attestation, or proof that a test command ran.

## Original provider evidence

- Repository: [SamCT86/trustpr-consumer-canary](https://github.com/SamCT86/trustpr-consumer-canary)
- [Pull request #6](https://github.com/SamCT86/trustpr-consumer-canary/pull/6), closed without merging
- [Actions run #39475939069](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/39475939069), `pull_request`, completed successfully on 20 October 2026
- Immutable Action source: `95d913eccbce6ccb547c293deaa8711272148e93` (published v0.1.1 **prerelease**, 21 October)
- Original GitHub artifact: `trustpr-6-39475939069-1`, ID `12288803366`, original ZIP SHA-256 `523c5464a7135afe0b09a53add1e6c3ad5f3857cd3a5364ce03652fe8bc03bbf`
- Original GitHub artifact expiration: `2026-10-27T18:34:41Z`; the archive files here do not depend on that retention window.

## Archived original files

| File | SHA-256 of original file bytes |
| --- | --- |
| [receipt.json](receipt.json) | `b87e9e34bada4300e4a9d5f7a52490684dec4a9257898fa0c46831996dd8da29` |
| [summary.md](summary.md) | `ad9950afb9f641023bee84501e58cc38c22cc43c7a1f68af8e9db1863e67cfcd` |

The files were extracted from the **original downloaded artifact** after verifying the ZIP SHA-256 against GitHub's artifact metadata and validating ZIP CRCs. GitHub provider readback of both committed file Git blob SHAs independently matched their original extracted bytes.

To check file integrity after downloading this directory, run:

```bash
printf '%s  %s\n' \
  b87e9e34bada4300e4a9d5f7a52490684dec4a9257898fa0c46831996dd8da29 receipt.json \
  ad9950afb9f641023bee84501e58cc38c22cc43c7a1f68af8e9db1863e67cfcd summary.md \
  | sha256sum -c -
```

The receipt reports `PARTIAL`, `UNAUTHENTICATED`, `POLICY_UNBOUND`, **one modified workflow file**, one observed GitHub check (TrustPR's own in-progress job), and `TEST_EXECUTION_NOT_ESTABLISHED`. The integrity digest in `receipt.json` is **not a signature**. The stored run is a public first-party fixture; an archived file plus a matching hash does **not** establish its author, external use, successful independent tests, safety, or merge authorization. For interpretation, see [the real-public-example guide](../../REAL-PUBLIC-EXAMPLE.md).
