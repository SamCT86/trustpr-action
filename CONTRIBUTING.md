# Contributing to TrustPR

TrustPR is a free, MIT-licensed, read-only GitHub Action that records observable Git changes and available GitHub pull-request evidence. It is **not** a test runner, authenticated attestation, security verdict, or permission to merge. Small, evidence-backed improvements are welcome.

## Start with an actual problem

- Trying the Action for the first time? Use the [five-step public-repository guide](START-HERE.md), then share a **non-sensitive** first-run result or the failed step in [issue #11](https://github.com/SamCT86/trustpr-action/issues/11).
- Found a reproducible bug? Open a focused [issue](https://github.com/SamCT86/trustpr-action/issues/new) with the exact TrustPR version or immutable commit SHA, relevant receipt status/unknown codes, expected versus observed behavior, and minimal sanitized reproduction.
- Before changing code, check [existing issues and PRs](https://github.com/SamCT86/trustpr-action/issues) to avoid duplicating a fix. A reported error is not, by itself, evidence that users have adopted the Action.

**Never post credentials, private repository URLs, confidential pull-request content, full private receipts, or personal data.** If a finding involves secrets or exploitable details, do not publish those details in a public issue. Contact the maintainer through an available private GitHub vulnerability-reporting channel if one is shown; if none is offered, ask publicly for a private reporting route **without describing the vulnerability**.

## Make one bounded change

1. Use a new branch. State the user-facing failure or improvement and what would falsify your hypothesis.
2. Preserve the default **read-only** permissions (contents, pull-requests, actions and checks), `pull_request` event binding, and complete **40-character immutable Action pin**. Do not introduce `pull_request_target`, PR-controlled shell execution, arbitrary network destinations, implicit write scopes, or credential persistence.
3. Preserve the evidence semantics: `PARTIAL` is incomplete, not PASS; `STALE` means the subject moved; `INVALID` means identity/structure failure; `VALID` is not proof of code safety. Retain `UNAUTHENTICATED`, `POLICY_UNBOUND` and the distinction between metadata and execution proof.
4. Add one focused positive case and one negative/error case for a behavior change. Where meaningful, show that the negative case fails on the original source and passes after the fix.
5. Open a PR with exact files changed, why, tests, limitations and expected user effect. This project does not require an external persona or standing review committee; repository protections and actual contributor permissions still apply.

## Test locally and on GitHub

Use Linux with Node.js **24 or newer** and Git available at `/usr/bin/git`. The package has no npm dependencies:

```bash
npm test
npm run test:release
```

The test suite covers deterministic receipts, read-only GitHub transport, immutable subjects, negative inputs, and simulated Action behavior. A local PASS is **not** hosted PASS. The repository's GitHub CI performs a fresh source test and pinned public pull-request fixtures. For runtime or setup changes, verify a real read-only GitHub-hosted consumer PR and inspect its receipt/summary; first-party canaries are not independent adoption.

Do not alter the published `v0.1.0` SHA, a frozen prerelease source SHA, or its verified package digest. New source improvements require a separately versioned future release, hosted validation, a deliberate release gate and rollback planning. Do not use an unreviewed PR to publish a GitHub release or list the Action on Marketplace.

## What makes a helpful report?

The most valuable report says **exactly what happened**: public run URL if safe to share, exact commit pin, reproducible input, receipt status plus unknown codes, the incorrect conclusion you feared, and one measurable improvement. Failure reports and critical feedback are as welcome as successful installations; stars and opinions are not substitutes for functioning consumer runs.
