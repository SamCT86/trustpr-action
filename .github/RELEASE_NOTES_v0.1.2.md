# TrustPR v0.1.2 — a simpler first read (prerelease)

TrustPR is a free, MIT-licensed, read-only GitHub Action. It shows observable Git changes and available GitHub PR evidence. It does not run pull-request code, establish that tests ran, sign attestations, certify safety, approve changes or authorize merging.

## What's better than v0.1.1?

Open the **GitHub Actions job Summary** after a pull request. The first screen now explains the receipt status in plain English, counts the Git changes and GitHub check **records** observed, and spells out what is still unknown. Detailed evidence remains under an expandable section.

**Important:** A GitHub check can be TrustPR's own job. A check count is not a count of passing tests. `PARTIAL` remains an expected incomplete-evidence status and is **not a merge pass**. `UNAUTHENTICATED` and `POLICY_UNBOUND` remain unchanged.

The downloadable `receipt.json`, `summary.md`, V1 Markdown rendering, digest and their verification logic are intentionally unchanged. Only the interactive GitHub job-summary presentation is different. The package remains `private: true` and is not on the npm registry.

## Source and installation

The planned immutable v0.1.2 source is `a37fa88a23e41139d6fed796827a1ebf4a9a5321`. Once the release tag, attached tarball and checksums are publicly verified, advanced users can explicitly pin that full SHA; the five-step install guide continues to pin the previously released v0.1.1 until it is updated separately. There is no moving tag silently substituted.

The v0.1.2 package's README now links directly to the public five-step guide and first-party example, even when those pages are not bundled inside the package. A package-only reader no longer encounters dead relative links.

This note does not itself prove that v0.1.2 has been published or independently adopted. Do not change your installation based on this draft alone.

## Quality and limitations

The candidate is tested using GitHub-hosted Node.js 24 CI, an Action PR canary in the source repository, pinned public same-repo/fork CLI fixtures, and an independent hosted package-byte digest. Those are maintainer-controlled checks, **not** independent adoption or evidence of a separately installed v0.1.2 consumer Action. Consumer-hosted acceptance and explicit owner release admission remain necessary before publication.

The old v0.1.0 shallow-ancestry flaw was addressed in v0.1.1. This change is a human-facing report improvement, not a new security proof. For candid feedback, use https://github.com/SamCT86/trustpr-action/issues/11 and never post tokens or sensitive receipt content.
