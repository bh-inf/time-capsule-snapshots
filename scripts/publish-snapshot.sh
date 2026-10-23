#!/usr/bin/env bash
# Publish v1/ with a deploy key. Rebase without stashing. Checks run again before push.
set -euo pipefail
export GIT_TERMINAL_PROMPT=0

if [[ "${GITHUB_REF:-refs/heads/main}" != "refs/heads/main" ]]; then
  echo "refusing to publish from ${GITHUB_REF}" >&2
  exit 1
fi

SOURCE="${1:-snapshot-out}"
ROOT="${2:-.}"

python3 "$ROOT/scripts/apply-snapshot-tree.py" "$SOURCE" "$ROOT"
python3 "$ROOT/scripts/pre-push-check.py" "$ROOT"

git -C "$ROOT" add v1
if git -C "$ROOT" diff --cached --quiet; then
  echo "no snapshot changes"
  exit 0
fi

git -C "$ROOT" -c user.name="snapshot-bot" -c user.email="snapshot-bot@users.noreply.github.com" \
  commit -m "snapshot: update archive"

git -C "$ROOT" fetch origin main
git -C "$ROOT" rebase origin/main

if [[ -n "$(git -C "$ROOT" ls-files -u)" ]]; then
  echo "unmerged files after rebase" >&2
  git -C "$ROOT" ls-files -u >&2
  exit 1
fi

python3 "$ROOT/scripts/pre-push-check.py" "$ROOT"

if [[ -n "${SNAPSHOT_PUBLISH_REMOTE:-}" ]]; then
  git -C "$ROOT" push "$SNAPSHOT_PUBLISH_REMOTE" HEAD:main
  exit 0
fi

if [[ -z "${SNAPSHOT_DEPLOY_KEY:-}" ]]; then
  echo "SNAPSHOT_DEPLOY_KEY is not set" >&2
  exit 1
fi

KEY_FILE="${HOME}/.ssh/snapshot_deploy_key"
mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"
trap 'rm -f "$KEY_FILE"' EXIT
printf '%s\n' "$SNAPSHOT_DEPLOY_KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"
printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "${HOME}/.ssh/known_hosts"
export GIT_SSH_COMMAND="ssh -i ${KEY_FILE} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
git -C "$ROOT" remote set-url origin git@github.com:bh-inf/time-capsule-snapshots.git
git -C "$ROOT" push origin HEAD:main
