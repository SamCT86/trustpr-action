# Report a security concern

TrustPR runs inside GitHub Actions and reads information about pull requests. If you find a way for it to expose credentials, run untrusted PR code, misidentify a PR, or make misleading claims about evidence, please tell us.

## Please keep the details private

1. On the [TrustPR repository](https://github.com/SamCT86/trustpr-action), open the **Security** tab. If GitHub shows **Report a vulnerability**, use that private form.
2. If no private reporting option is available, [open a public issue](https://github.com/SamCT86/trustpr-action/issues/new) titled **“Request a private security reporting channel”**. Ask for a private route **without including the vulnerability details**.
3. If a credential has already been exposed, revoke or rotate it in the system that issued it. **Do not paste tokens, private receipts, exploits, or personal information into public issues.**

A useful private report identifies the affected TrustPR version or full commit SHA, what happened, what you expected, and minimal steps to reproduce the problem safely. No exploit proof should be published before there is an appropriate private contact path.

## What TrustPR promises — and what it doesn't

- The documented beginner workflow uses **read-only GitHub permissions**. TrustPR does not intentionally check out and run code from the proposed pull request.
- A `PARTIAL` receipt means evidence is incomplete. A green GitHub Actions job does not establish that independent tests ran.
- TrustPR does **not** provide a cryptographic signature, guarantee code safety, enforce team approval policies, or authorize a merge.

The currently published installation is the [v0.1.1 prerelease](https://github.com/SamCT86/trustpr-action/releases/tag/v0.1.1). The older v0.1.0 prerelease has a documented [shallow Git-ancestry issue](https://github.com/SamCT86/trustpr-action/issues/21), addressed in v0.1.1. Future source candidates are **not published releases**.

This is a free, MIT-licensed community project. We cannot promise a paid bounty, a service-level agreement, or a fixed response time. We will distinguish a report from a verified fix and published release.
