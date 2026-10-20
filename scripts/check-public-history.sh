#!/usr/bin/env bash
# Read-only gate for the entire local reachable history, never a remote erasure proof.
# Apply to the exact clean-history candidate; retain the private predecessor.
set -euo pipefail
repo=${1:-.}
# Inspect the requested repository even when the caller has Git overrides set.
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_INDEX_FILE GIT_SHALLOW_FILE GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
export GIT_NO_REPLACE_OBJECTS=1 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_OPTIONAL_LOCKS=0
hold(){ echo "$1" >&2; exit 1; }
git_repo(){ /usr/bin/git -C "$repo" -c core.commitGraph=false -c core.fsmonitor=false "$@"; }
git_repo rev-parse --is-inside-work-tree >/dev/null 2>&1 || hold HOLD_NOT_A_GIT_WORKTREE
git_repo rev-parse --verify HEAD >/dev/null 2>&1 || hold HOLD_NO_COMMIT_HISTORY
shallow=$(git_repo rev-parse --is-shallow-repository) || hold HOLD_HISTORY_UNREADABLE
[[ "$shallow" == false ]] || hold HOLD_SHALLOW_HISTORY
# Legacy grafts can hide ancestry even with replace refs disabled.
graft_file=$(git_repo rev-parse --git-path info/grafts) || hold HOLD_HISTORY_UNREADABLE
if [[ "$graft_file" != /* ]]; then graft_file="$repo/$graft_file"; fi
[[ ! -s "$graft_file" ]] || hold HOLD_GRAFTED_HISTORY
if git_repo ls-files --error-unmatch RUNTIME_SOURCE_MANIFEST.json >/dev/null 2>&1; then
  hold HOLD_INTERNAL_MANIFEST_STILL_TRACKED
fi
# Default path history simplification can prune a merged side branch whose
# manifest was deleted before merging. Inspect every reachable parent instead.
history=$(git_repo log --all --full-history --format=%H -- RUNTIME_SOURCE_MANIFEST.json) || hold HOLD_HISTORY_UNREADABLE
[[ -z "$history" ]] || hold HOLD_INTERNAL_MANIFEST_IN_GIT_HISTORY
echo PASS_NO_KNOWN_INTERNAL_MANIFEST_IN_COMPLETE_REACHABLE_HISTORY
