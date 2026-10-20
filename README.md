# TrustPR

TrustPR collects a pull request's Git changes and GitHub evidence into a JSON receipt and a readable summary. It makes missing or inconsistent evidence visible before someone relies on a green check.

## Start here — GitHub Action in five steps

**[Install TrustPR without a terminal](START-HERE.md)** using a copy-and-paste, read-only workflow pinned to the published **v0.1.1 prerelease**. It produces a GitHub job summary and a downloadable JSON evidence receipt. No TrustPR account or payment is required; GitHub Actions usage is subject to your GitHub plan.

**Why upgrade from v0.1.0?** In specially truncated shallow Git history, the previous v0.1.0 collector could report an overconfident `VALID` ([issue #21](https://github.com/SamCT86/trustpr-action/issues/21)). v0.1.1 conservatively returns `PARTIAL / SHALLOW_ANCESTRY_NOT_ESTABLISHED` instead. Neither result proves safe code or authorizes merging.

**What the receipt does not prove:** an ordinary result can be **PARTIAL**; that is not a merge PASS. Receipts remain **UNAUTHENTICATED** and **POLICY_UNBOUND**. TrustPR does not execute PR tests, cryptographically attest evidence, approve changes, or authorize merging.


Run the local demo:

```bash
npm run demo
```

The demo creates a temporary synthetic Git repository, generates a receipt, and removes the repository. It makes no network request and executes no code from a pull request.

TrustPR is MIT-licensed, copyright © 2026 Sarmad Tawfeek. The canonical release repository is `SamCT86/trustpr-action`; see `LICENSE` for the redistribution terms. No npm registry publication is claimed.

## Requirements

Node.js 24 or later and Git at `/usr/bin/git` on Linux. No npm dependencies are required. The source CLI works directly; an owner-reviewed package can also be installed from its local tarball with `npm install --offline --ignore-scripts /path/to/package.tgz`, then run with `npx --offline trustpr --help`. No npm registry publication is claimed.

## Install the verified prerelease

The [v0.1.1 prerelease](https://github.com/SamCT86/trustpr-action/releases/tag/v0.1.1) includes a dependency-free tarball and `SHA256SUMS`. Download both assets into one directory, then run:

```bash
sha256sum -c SHA256SUMS
npm install --offline --ignore-scripts --no-audit --no-fund ./trustpr-runtime-rebaseline-0.1.1.tgz
./node_modules/.bin/trustpr --help
./node_modules/.bin/trustpr --repo OWNER/REPO --pr NUMBER --output ./new-receipt-directory
```

The release source is pinned to `95d913eccbce6ccb547c293deaa8711272148e93`. See the release notes for its exact package checksum, hosted verification and evidence limits.

## Collect a real public pull request

```bash
node bin/trustpr.mjs --repo OWNER/REPO --pr NUMBER --output ./new-receipt-directory
```

The command prints JSON and creates `receipt.json` and `summary.md` in a new directory. Existing output directories are refused.

For an expected immutable subject, add both:

```text
--base-sha FULL_40_HEX_BASE_SHA --head-sha FULL_40_HEX_HEAD_SHA
```

If the provider reports a different subject, the receipt is INVALID.

The default path fetches the exact commits into a temporary bare Git repository from a fixed public GitHub URL. It never checks out the pull request or runs its code. It removes that temporary store afterward. To use objects already available locally, add `--git-directory /absolute/path/to/.git`; that collector permits no network protocols.

An optional `GITHUB_TOKEN` environment variable is used only for GET requests to `https://api.github.com`. Never put a token on the command line. The Git-object fetch receives no credentials. Private repositories or inaccessible fork objects can therefore leave the Git evidence incomplete.

## Read the result

- **PARTIAL:** some evidence is missing or unknown.
- **STALE:** the pull request changed during collection.
- **INVALID:** identity, generation, or required structure is inconsistent.
- **VALID:** evidence is internally coherent and complete for its declared scope; it never means safe to merge.

The default runtime collects GitHub metadata. It does not retrieve artifact bytes or establish which test commands ran. GitHub's run-scoped artifact list also does not establish which run attempt produced an artifact; TrustPR leaves that attempt unknown rather than copying the current run attempt. A check suite association does not establish an individual check's producing attempt either. Those facts stay explicitly unknown, so ordinary coherent runs return PARTIAL. A successful CLI command means a receipt was generated; it is not a merge gate. The GitHub Action fails after saving the receipt when evidence is INVALID or STALE. PARTIAL emits a warning and succeeds so the incomplete evidence remains visible; it never authorizes a merge.

Receipts stay **UNAUTHENTICATED** and **POLICY_UNBOUND**. Their SHA-256 digest detects changes relative to the recorded digest; someone can rewrite both receipt and digest. It is not a signature, proof of authorship, or authorization.

Missing or malformed provider counts, commit identities, check records and artifact expiry metadata leave the affected collection incomplete. Valid records on that page remain visible; an observed conflicting commit still makes the receipt INVALID. The JSON receipt and summary preserve stable collection failure codes such as `PROVIDER_RESPONSE_INVALID`, `PERMISSION_DENIED` and `RATE_LIMITED`, without copying provider error messages.

## Verify and render a saved receipt

```bash
node bin/trustpr.mjs --verify-receipt receipt.json --output ./new-verification-directory
```

This validates the bounded schema, subject identity and digest, then regenerates Markdown. It verifies integrity and format, not the factual truth of supplied evidence.

## GitHub Action

`action.yml` and `bin/action.mjs` implement the same runtime. The Action accepts only the `pull_request` event and binds repository, pull request number, base SHA and head SHA to that event before reading provider evidence. `pull_request_target` is rejected.

Save this as `.github/workflows/trustpr.yml` in a public consumer repository. The full commit pin identifies the verified v0.1.1 Action:

```yaml
name: TrustPR evidence receipt
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  actions: read
  checks: read
  contents: read
  pull-requests: read
jobs:
  trustpr:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: SamCT86/trustpr-action@95d913eccbce6ccb547c293deaa8711272148e93
        with:
          repository: ${{ github.repository }}
          pull-request-number: ${{ github.event.pull_request.number }}
          base-sha: ${{ github.event.pull_request.base.sha }}
          head-sha: ${{ github.event.pull_request.head.sha }}
```

The Action needs no external service account, GitHub App or write permission for this public path. It writes a runner summary and local receipt paths; it does not post comments, upload artifacts, change checks or merge. The included workflow generator in `src/action-setup.mjs` accepts an explicit full commit SHA for the same fixed repository.

For private repositories, the caller can supply `git-directory` as an absolute directory containing already fetched Git objects. TrustPR reads that store with all Git network protocols disabled. Fetch the exact base/head objects with your own read-only checkout step and `persist-credentials: false`; supply a complete enough history for the merge base. TrustPR does not check out or execute PR code. Missing objects remain explicitly incomplete. Omit the input to retain the credential-free public Git fetch.

## Validation and limits

```bash
npm test
```

`test:runtime` runs the runtime tests in `test/*.test.mjs`, including actual offline npm installation and Action outcome regressions. Passing these tests does not claim a historical full-regression PASS or a GitHub-hosted CI PASS.

Input JSON uses `TRUSTPR_BOUNDED_INTEGER_JSON_V1`: strict UTF-8, scalar Unicode, duplicate-key rejection, safe integer numbers only, maximum 8 MiB, depth 64, and 100,000 value nodes. Fractions and exponent forms are rejected. Digest canonicalization reuses the existing renderer's bounded integer format; this does not claim support for all RFC 8785 numeric inputs.

Git evidence uses SHA-1 commit/object IDs and a merge-base-to-head raw diff with rename inference disabled. The collector ignores local replacement refs, legacy graft files and commit-graph caches when reading commit ancestry. Before collecting a diff, it runs an offline Git object-integrity check with a 20-second deadline. Corrupt objects or an unsuccessful integrity check leave the diff empty and explicitly incomplete; this also applies to unrelated corrupt objects in a caller-supplied store. Paths retain their original bytes as base64. Missing objects, multiple merge bases, submodules, LFS content and inspection limits remain unknown. Diff limits are 8 MiB, 1,000 entries, 1 MiB per inspected blob and 16 MiB total inspected blob bytes. Public fetch depth is 128; shallow ancestry may leave the merge base unavailable.

HTTP responses are bounded to 8 MiB. API reads reject redirects and cross-origin pagination, allow at most 500 requests, and have a three-minute transport deadline. Rate limits and read failures produce explicit unavailable evidence. No automatic provider retry or GitHub write occurs.

Optional artifact-byte and pinned offline attestation modules are retained and tested separately. They do not upgrade this runtime's metadata receipts to authenticated evidence.

## Release verification

The read-only GitHub CI workflow runs the runtime tests, the installed npm executable and a source-repository Action canary bound to an actual pull request event. It also collects pinned public same-repository/fork PR fixtures, compares paths to GitHub, and verifies receipt/summary byte roundtrips. Each CI result applies to its exact tested commit.

The **previous** v0.1.0 Action pin passed real public consumer [same-repository](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/38158633148) and [Dependabot](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/38158695560) PR events with read-only permissions. Saved artifact bytes, event subjects, changed paths and rendered summaries were independently verified. The Dependabot run is not a fork Action event; the public CLI fork fixture is separate evidence. These historical results apply to the old immutable v0.1.0 pin, **not** the new v0.1.1 installation pin. The exact v0.1.1 source was exercised in a first-party GitHub-hosted consumer [PR #5 run 39410380329](https://github.com/SamCT86/trustpr-consumer-canary/actions/runs/39410380329); external adoption and Dependabot consumer verification of v0.1.1 remain unverified. Ordinary receipts stay PARTIAL, UNAUTHENTICATED and POLICY_UNBOUND; no merge authorization is granted.

The manual `publication-preflight.yml` workflow checks the MIT text, exact distribution files and complete reachable Git history. It never publishes or approves a release. You can run the same checks locally with `npm test`, `npm run test:release`, and `bash scripts/check-public-history.sh .`. Neither gate proves copyright ownership, publication permission or that hosted CI passed. The project owner separately approved publication and supplied the copyright-holder name.

The release package intentionally remains `private: true` to prevent accidental npm registry publication. Install from a reviewed local tarball or use the source CLI; no registry publication is claimed.
