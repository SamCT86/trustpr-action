# TrustPR — start in five steps

**One file to copy. No terminal. No TrustPR account or payment.**

TrustPR adds a readable report to a GitHub pull request (PR — a proposed code change). It shows **what changed**, **what GitHub reported**, and **what couldn't be confirmed**.

The pinned TrustPR Action itself doesn't check out or run the PR's code, approve changes, or merge anything. A green GitHub check does **not** mean the code is safe.

**Before you start:** You need a **public** GitHub repository where you can add a workflow file. TrustPR is free; GitHub Actions usage follows your GitHub plan.

## Add TrustPR to your repository

**1.** On GitHub, open *your own repository*. Select **Add file → Create new file** (you may need to select the **Code** tab first).

**2.** In the filename box, enter exactly:

`.github/workflows/trustpr.yml`

> **Security before you paste:** The pinned Action is read-only, but a PR can change the workflow YAML itself. Review edits to `.github/workflows/trustpr.yml` before approving runs; never add secrets, write permissions, or steps that execute PR code.

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
        uses: SamCT86/trustpr-action@95d913eccbce6ccb547c293deaa8711272148e93
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

**5.** Open a new pull request, or push a commit to an existing one. In your repository, go to **Actions → TrustPR receipt** and open the matching run. Read the **Summary**. To keep a copy, find **Artifacts** and download the `trustpr-...` report, if available.

**You're done.** TrustPR now runs when a pull request is opened or updated. You don't install Node.js or supply a separate token.

## Read your report

| Result | What it means |
| --- | --- |
| **PARTIAL** | We could check some evidence, but not everything. **This is normal. It is not a pass.** |
| **INVALID** | The PR identity or evidence doesn't line up. Investigate before relying on this report. |
| **STALE** | The PR changed while we were checking. Start a new run for the **latest PR commit**, not the old one. |
| **VALID** | Available evidence is internally consistent for the limited scope checked. **Not proof the code is safe.** |

**Why can the GitHub job be green when the report says PARTIAL?** Green means TrustPR finished collecting a report without a fatal error. It doesn't prove tests ran or authorize a merge. A listed GitHub check may even be TrustPR's own job.

Two more labels explain the limits: **UNAUTHENTICATED** means the receipt is not cryptographically signed. **POLICY_UNBOUND** means it doesn't apply your team's review or approval rules.

## I don't see a report

- **No workflow?** Make sure the file above is on the repository's default branch. Confirm GitHub Actions is enabled under **Settings → Actions → General**. Then open or update a PR.
- **A fork PR is awaiting approval?** GitHub can require a maintainer to approve Actions runs from first-time or outside contributors. The maintainer must **review the PR's changed files, especially workflow edits**, before selecting **Awaiting approval → Approve workflows to run**. If you do not have write access, ask a maintainer; do not bypass this safety setting. See [GitHub's approval instructions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks).
- **A job is red?** Open its logs in the **Actions** tab. `INVALID` and `STALE` can intentionally fail the job. Use the receipt to investigate.
- **No downloaded file?** Look under the completed workflow run's **Artifacts** section. The example retains reports for seven days. A failure before the receipt is generated may leave no file.
- **Using a private repo?** This beginner workflow targets *public* repositories. Private PR Git objects may not be accessible using the credential-free default collector; see the main [README](README.md) for `git-directory` setup.
- **Not sure what a PR is?** You can try this safely on a test repository first, with a harmless README change.

## Cost, security, and support

**Workflow edits need review.** This copy-and-paste workflow has no step that runs PR code. However, GitHub's `pull_request` event uses workflow definitions from the PR's **merge commit**. Someone proposing a change to `.github/workflows/trustpr.yml` can therefore change the *workflow* that runs, even though the pinned TrustPR Action itself stays read-only. The permissions shown above are not an enforcement boundary against a PR-edited workflow. Review workflow-file changes before approving a run (especially on forks), and never add secrets, write permissions, or steps that execute untrusted PR code. See [GitHub's security explanation of the `pull_request` event](https://github.com/github/docs/blob/main/content/actions/reference/security/securely-using-pull_request_target.md).

TrustPR itself is **free, MIT-licensed, and open source**. GitHub Actions usage and limits are governed by your GitHub plan. The pinned Action requests **read-only** GitHub permissions, does not run code from the PR, and does not merge or comment on anything. Downloadable reports can contain PR metadata, so avoid publishing reports that you would not otherwise share.

**Why v0.1.1?** The older v0.1.0 Git-diff collector could overstate *component-level* certainty with specially truncated Git history ([issue #21](https://github.com/SamCT86/trustpr-action/issues/21)). v0.1.1 reports incomplete ancestry conservatively. Neither version proves test execution or safe code.

**Want to see a real result first?** Read this [maintainer-run public PR example](REAL-PUBLIC-EXAMPLE.md). It is not an independent user testimonial.

For technical details, see the [README](README.md). For help, [open a GitHub issue](https://github.com/SamCT86/trustpr-action/issues). The [v0.1.1 prerelease](https://github.com/SamCT86/trustpr-action/releases/tag/v0.1.1) was published on 21 October 2026 and its tag and package digest were verified. The example installation was tested in a maintainer-controlled GitHub-hosted repository; independent adoption is not yet established.
