# TrustPR: start here

**Free and open source. No separate TrustPR account, no payment, no terminal required.** You need a GitHub account and access to a repository.

TrustPR reads the evidence around a GitHub pull request (PR) and makes a short report. A **PR** is a proposed change to a repository. TrustPR does **not** approve code, merge it, or tell you a change is safe.

## Install on a public GitHub repository

You need permission to add a file to the repository. These instructions use the tested **v0.1.0 prerelease** of TrustPR—not the newer v0.1.1 development branch.

**1.** On GitHub, open *your own repository*. Select **Add file → Create new file** (you may need to select the **Code** tab first).

**2.** In the filename box, enter exactly:

`.github/workflows/trustpr.yml`

**3.** Paste **all** of the following into the editor:

```yaml
name: TrustPR receipt

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
      - name: Check PR evidence (no PR code is run)
        id: receipt
        uses: SamCT86/trustpr-action@3ac08375bed6380285fcfd8019cef0cb7931dda8
        with:
          repository: ${{ github.repository }}
          pull-request-number: ${{ github.event.pull_request.number }}
          base-sha: ${{ github.event.pull_request.base.sha }}
          head-sha: ${{ github.event.pull_request.head.sha }}

      - name: Save the receipt as a downloadable report
        if: ${{ always() && steps.receipt.outputs.receipt-path != '' }}
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f
        with:
          name: trustpr-${{ github.event.pull_request.number }}-${{ github.run_id }}-${{ github.run_attempt }}
          path: |
            ${{ steps.receipt.outputs.receipt-path }}
            ${{ steps.receipt.outputs.summary-path }}
          retention-days: 7
          if-no-files-found: error
```

**4.** Select **Commit changes** to save this workflow to your repository's **default branch** (usually `main`). If GitHub requires a PR for protected branches, propose the file change and merge it through your normal review process.

**5.** Open a *new* pull request in your repository (or push another commit to an existing one). Go to **Actions → TrustPR receipt** and open the matching run. Read the **job summary**. Under **Artifacts**, download the `trustpr-...` report if available.

That's it. TrustPR runs on new or updated PRs. You don't need to install Node.js, run commands, or give TrustPR a separate token.

## What do the results mean?

| Result | Plain-English meaning |
| --- | --- |
| **PARTIAL** | Expected for ordinary PRs: some evidence cannot be confirmed. **This is not a pass or permission to merge.** |
| **INVALID** | The expected PR identity or evidence structure disagrees. Investigate before relying on the receipt. |
| **STALE** | The PR changed while it was being checked. Run it again on the latest commit. |
| **VALID** | The collected evidence is internally consistent for its stated scope. **It does not prove the code is safe.** |

Your report also says **UNAUTHENTICATED** and **POLICY_UNBOUND**. This means it is **not** a cryptographically signed audit certificate and does **not** apply your team's approval policy. Do not use the report as an automatic merge gate.

## I don't see a report

- **No workflow?** Make sure the file above is on the repository's default branch. Confirm GitHub Actions is enabled under **Settings → Actions → General**. Then open or update a PR.
- **A fork PR is awaiting approval?** GitHub can require a maintainer to approve Actions runs from first-time or outside contributors. The maintainer must **review the PR's changed files, especially workflow edits**, before selecting **Awaiting approval → Approve workflows to run**. If you do not have write access, ask a maintainer; do not bypass this safety setting. See [GitHub's approval instructions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks).
- **A job is red?** Open its logs in the **Actions** tab. `INVALID` and `STALE` can intentionally fail the job. Use the receipt to investigate.
- **No downloaded file?** Look under the completed workflow run's **Artifacts** section. The example retains reports for seven days. A failure before the receipt is generated may leave no file.
- **Using a private repo?** This beginner workflow targets *public* repositories. Private PR Git objects may not be accessible using the credential-free default collector; see the main [README](README.md) for `git-directory` setup.
- **Not sure what a PR is?** You can try this safely on a test repository first, with a harmless README change.

## Cost, security, and support

TrustPR itself is **free, MIT-licensed, and open source**. GitHub Actions usage and limits are governed by your GitHub plan. The pinned Action requests **read-only** GitHub permissions, does not run code from the PR, and does not merge or comment on anything. Downloadable reports can contain PR metadata, so avoid publishing reports that you would not otherwise share.

For the technical details, source code, limitations and command-line usage, see the main [TrustPR README](README.md). For bugs, open an issue in [trustpr-action](https://github.com/SamCT86/trustpr-action/issues). The upcoming v0.1.1 candidate is **not** claimed as publicly released here.
