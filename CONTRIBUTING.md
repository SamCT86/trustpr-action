# Help make TrustPR clearer

**You don't need to write code to help.** If you tried TrustPR and something was confusing, tell us. A short report is more valuable than a guess about what might help.

## Just tried TrustPR?

1. [Use the five-step setup guide](START-HERE.md) on a **public** GitHub repository.
2. Open a pull request and look at **Actions → TrustPR receipt → Summary**.
3. [Tell us what worked or where you got stuck](https://github.com/SamCT86/trustpr-action/issues/11). One or two sentences are enough.

You can share a **public** GitHub run URL if you want, but please **never share passwords, access tokens, private receipt contents or personal data**.

**What does PARTIAL mean?** TrustPR found some evidence but couldn't establish everything. This is normal; `PARTIAL` is **not a pass**, and green GitHub jobs are not proof your tests ran. TrustPR itself is free, MIT-licensed and read-only.

## Found a bug or want to contribute code?

[Open an issue](https://github.com/SamCT86/trustpr-action/issues/new) with a short description: what you expected, what happened, and (if possible) one safe way to reproduce it. Check [existing issues](https://github.com/SamCT86/trustpr-action/issues) before starting the same fix. A small, focused pull request is welcome.

If you think you've found a security issue, don't post exploitable details or secrets publicly. Use a private GitHub vulnerability-reporting channel if available; otherwise ask the maintainer for a private reporting route **without describing the vulnerability**.

---

## For code contributors

### Make one bounded change

1. Use a new branch. State the user-facing failure or improvement and what would falsify your hypothesis.
2. Preserve the default **read-only** permissions (contents, pull-requests, actions and checks), `pull_request` event binding, and complete **40-character immutable Action pin**. Do not introduce `pull_request_target`, PR-controlled shell execution, arbitrary network destinations, implicit write scopes, or credential persistence.
3. Preserve the evidence semantics: `PARTIAL` is incomplete, not PASS; `STALE` means the subject moved; `INVALID` means identity/structure failure; `VALID` is not proof of code safety. Retain `UNAUTHENTICATED`, `POLICY_UNBOUND` and the distinction between metadata and execution proof.
4. Add one focused positive case and one negative/error case for a behavior change. Where meaningful, show that the negative case fails on the original source and passes after the fix.
5. Open a PR with exact files changed, why, tests, limitations and expected user effect. This project does not require an external persona or standing review committee; repository protections and actual contributor permissions still apply.

### Test locally and on GitHub

Use Linux with Node.js **24 or newer** and Git available at `/usr/bin/git`. The package has no npm dependencies:

```bash
npm test
npm run test:release
```

The test suite covers deterministic receipts, read-only GitHub transport, immutable subjects, negative inputs, and simulated Action behavior. A local PASS is **not** hosted PASS. The repository's GitHub CI performs a fresh source test and pinned public pull-request fixtures. For runtime or setup changes, verify a real read-only GitHub-hosted consumer PR and inspect its receipt/summary; first-party canaries are not independent adoption.

Do not alter the published `v0.1.0` or `v0.1.1` commit pins, immutable release assets, or their verified package digests. New source improvements require a separately versioned future release, hosted validation, a deliberate release gate and rollback planning. Do not use an unreviewed PR to publish a GitHub release or list the Action on Marketplace.

### What makes a helpful report?

The most valuable report says **exactly what happened**: public run URL if safe to share, exact commit pin, reproducible input, receipt status plus unknown codes, the incorrect conclusion you feared, and one measurable improvement. Failure reports and critical feedback are as welcome as successful installations; stars and opinions are not substitutes for functioning consumer runs.
