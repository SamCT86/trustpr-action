# A real TrustPR run — what PARTIAL actually means

## First run of the five-step workflow (actual GitHub-hosted consumer)

The most realistic beginner fixture is **[consumer PR #6](https://github.com/SamCT86/trustpr-consumer-canary/pull/6)**. Its [GitHub Actions run 39475939069](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/39475939069) completed successfully on 20 October 2026. It used the **full immutable v0.1.1 source SHA** `95d913eccbce6ccb547c293deaa8711272148e93` for the TrustPR Action with read-only permissions. **That SHA is a source candidate, not a v0.1.1 release.** The five-step installation guide still pins the separately published v0.1.0 prerelease.

GitHub uploaded [artifact `trustpr-6-39475939069-1`](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/39475939069) (ID `12288803366`, original ZIP SHA-256 `523c5464a7135afe0b09a53add1e6c3ad5f3857cd3a5364ce03652fe8bc03bbf`). The original downloaded `receipt.json` says:

| What was recorded | Original receipt or live provider check |
| --- | --- |
| Evidence status | `PARTIAL` — not a merge pass |
| Authenticity and policy | `UNAUTHENTICATED` / `POLICY_UNBOUND` |
| Git change observed | One file: `.github/workflows/trustpr.yml` |
| GitHub checks in receipt | **1 observed check**, `check_run_id=118811794878`, `in_progress` at collection |
| What that check actually was | GitHub's **TrustPR collector job itself**, job ID `118811794878` in the same workflow run; it later completed successfully |
| Independently established test execution | **None**. `TEST_EXECUTION_NOT_ESTABLISHED` remains an explicit unknown |
| Producing attempt for the observed check | Unknown: `CHECK_ATTEMPT_NOT_ESTABLISHED` |
| Receipt integrity value | Core digest `485ef4d3edbfd058a00080833de47e24c286df5a9b733c97c41339b916108c26` (SHA-256, **not** an authenticated signature) |

**Why does the report list a check if no tests were proved?** GitHub exposes checks for Actions jobs, including the job currently collecting TrustPR evidence. **A check count is not a test count.** The collector's later green job means evidence collection did not fail; it does not retroactively make its in-progress snapshot a completed test or turn `PARTIAL` into review approval.

This is a **maintainer-controlled, first-party** consumer repository. The PR was closed without merging. It is **not** evidence of an independent installation, external feedback or verified test execution. Artifact downloads are subject to GitHub retention; the [Actions run and job page](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/39475939069) retain the public provenance. An actionable readability improvement is tracked separately in [issue #37](https://github.com/SamCT86/trustpr-action/issues/37); no fix is claimed as shipped.

---

This is a **public first-party canary**, not evidence of independent user adoption. It shows what TrustPR reported when a pull request modified a GitHub workflow, without executing the PR's code.

- [Consumer pull request #5](https://github.com/SamCT86/trustpr-consumer-canary/pull/5) (closed without merge)
- [GitHub-hosted run #39410380329](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/39410380329) — `completed / success`, 2026-10-20
- TrustPR source SHA used: `95d913eccbce6ccb547c293deaa8711272148e93` (**v0.1.1 source candidate**, not the published v0.1.0 release pin)
- Pull request subject: repository ID `1414582128`, PR `5`, base `1d1b4e41a00c57ec387f692acbe8578c653a250d`, head `0814bcd763187f8dee4bcf11ff2b3121ad156ef6`

## What appeared in the verifier's log

This excerpt is a **condensed copy of fields logged by the first-party verifier**, **not** the complete JSON receipt or an independent attestation:

```json
{
  "status": "INTEGRITY_VALID",
  "receipt_status": "PARTIAL",
  "authenticity": "UNAUTHENTICATED",
  "policy_binding": "POLICY_UNBOUND",
  "merge_authorized": false,
  "changed_paths": [".github/workflows/trustpr.yml"],
  "git_diff_complete": true,
  "summary_byte_match": true,
  "unknown_codes": [
    "CHECK_ATTEMPT_NOT_ESTABLISHED",
    "TEST_EXECUTION_NOT_ESTABLISHED"
  ]
}
```

TrustPR collected the Git diff and compared the changed paths with GitHub's read-only API for that public PR. The report's own digest was internally consistent and the rendered summary matched the saved receipt bytes. **None of these facts proves that a test command actually ran, that the PR is safe, or that the receipt has a trusted author.**

The workflow run's uploaded artifact was named `trustpr-consumer-5-39410380329-1` (artifact ID `12259590678`). GitHub retention may eventually expire the download; the public [run log](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/39410380329) remains the primary evidence link. The verifier and artifact both belong to the maintainer's test repository.

## Why did a green GitHub Action still report PARTIAL?

A successful Action run means **the evidence collection completed without a fatal identity/staleness error**, not that all evidence was available. In this run the producing attempt for an individual GitHub check was unconfirmed, and no proof of test execution was established. TrustPR kept those uncertainties visible. `PARTIAL` is **never** a merge approval.

## Try it yourself

Follow the [five-step beginner guide](START-HERE.md), which currently pins the **published v0.1.0 prerelease** by its full immutable commit SHA. The v0.1.1 source shown above is **not** silently substituted for that published version. If anything is confusing, post a non-sensitive experience report on [feedback issue #11](https://github.com/SamCT86/trustpr-action/issues/11); do not publish tokens, confidential PR data or private receipts.
