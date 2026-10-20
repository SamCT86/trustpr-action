# TrustPR v0.1.1 — evidence quality hardening (prerelease)

This free MIT-licensed GitHub Action collects observable Git changes and available GitHub pull-request evidence into a local JSON receipt and readable summary.

**What changed since v0.1.0:** conservative improvements to PR identity and Git ancestry checking, incomplete provider-evidence handling, artifact provenance limits and regression coverage. On a coherent but incomplete PR, `PARTIAL` remains expected; an incomplete receipt is not a merge PASS.

**Specific Git-ancestry regression fixed:** in a synthetic criss-cross history with a shallow boundary hiding a second merge base, v0.1.0 could report `VALID` for incomplete ancestry. v0.1.1 instead reports `PARTIAL / SHALLOW_ANCESTRY_NOT_ESTABLISHED` without accepting the provisional merge base. This is a first-party adversarial reproduction, **not** a confirmed external-user incident; see [issue #21](https://github.com/SamCT86/trustpr-action/issues/21).

**Verified before publishing:** v0.1.1 source at `95d913eccbce6ccb547c293deaa8711272148e93` passed first-party GitHub CI and a GitHub-hosted consumer PR run ([run 39410380329](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/39410380329)). These runs are maintainer-controlled, not independently adopted uses. The manual publication workflow tests source and package hashes again before it can create this prerelease.

**Install:** the [five-step GitHub Action guide](https://github.com/SamCT86/trustpr-action/blob/main/START-HERE.md) deliberately continues to pin the independently published **v0.1.0** until an updated beginner workflow is tested and documented. Advanced users may deliberately pin this v0.1.1 source commit after reviewing the changes. Do not silently replace an immutable pin.

**Limitations:** Receipts are `UNAUTHENTICATED` and `POLICY_UNBOUND`. They do not prove tests executed, cryptographically attest authorship, establish safety, authorize merging or apply organization approval policies. Missing GitHub data produces explicit unknowns. The Action does not run untrusted PR code.

**Assets:** `trustpr-runtime-rebaseline-0.1.1.tgz` and `SHA256SUMS`, built from the exact source above. Compare `sha256sum -c SHA256SUMS` before local installation. The package stays `private: true`; this is not npm registry publication.

**Feedback:** report an honest first-run result or setup failure in [issue #11](https://github.com/SamCT86/trustpr-action/issues/11). Do not share private receipts, API tokens or sensitive repository details.
