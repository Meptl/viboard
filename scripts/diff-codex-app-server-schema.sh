#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  cat <<'USAGE' >&2
Usage: scripts/diff-codex-app-server-schema.sh <from-tag> <to-tag> [schema-root]

Examples:
  scripts/diff-codex-app-server-schema.sh rust-v0.118.0 rust-v0.125.0
  scripts/diff-codex-app-server-schema.sh rust-v0.124.0 rust-v0.125.0 codex-rs/app-server-protocol/schema/json/v2
USAGE
  exit 1
fi

FROM_TAG="$1"
TO_TAG="$2"
SCHEMA_ROOT="${3:-codex-rs/app-server-protocol/schema/json/v2}"
REPO_URL="https://github.com/openai/codex.git"

if ! command -v git >/dev/null 2>&1; then
  echo "error: git is required" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

REPO_DIR="$TMP_DIR/codex"
git clone --quiet --filter=blob:none --no-checkout "$REPO_URL" "$REPO_DIR"

cd "$REPO_DIR"

if ! git rev-parse --verify "$FROM_TAG^{commit}" >/dev/null 2>&1; then
  echo "error: tag or ref '$FROM_TAG' was not found in $REPO_URL" >&2
  exit 1
fi
if ! git rev-parse --verify "$TO_TAG^{commit}" >/dev/null 2>&1; then
  echo "error: tag or ref '$TO_TAG' was not found in $REPO_URL" >&2
  exit 1
fi

echo "Schema root: $SCHEMA_ROOT"
echo "Comparing:  $FROM_TAG -> $TO_TAG"
echo
echo "Changed schema files:"
git diff --name-status "$FROM_TAG" "$TO_TAG" -- "$SCHEMA_ROOT" || true

if ! command -v jq >/dev/null 2>&1; then
  echo
  echo "note: jq not found; skipping required-field diff details."
  exit 0
fi

echo
echo "Required field deltas by file:"

mapfile -t CHANGED_FILES < <(git diff --name-only "$FROM_TAG" "$TO_TAG" -- "$SCHEMA_ROOT")

if [[ ${#CHANGED_FILES[@]} -eq 0 ]]; then
  echo "(none)"
  exit 0
fi

for file in "${CHANGED_FILES[@]}"; do
  old_tmp="$(mktemp)"
  new_tmp="$(mktemp)"
  old_sorted="$(mktemp)"
  new_sorted="$(mktemp)"
  added_tmp="$(mktemp)"
  removed_tmp="$(mktemp)"
  trap 'rm -f "$old_tmp" "$new_tmp" "$old_sorted" "$new_sorted" "$added_tmp" "$removed_tmp"' RETURN

  if git cat-file -e "$FROM_TAG:$file" 2>/dev/null; then
    git show "$FROM_TAG:$file" >"$old_tmp"
  else
    printf '{}' >"$old_tmp"
  fi

  if git cat-file -e "$TO_TAG:$file" 2>/dev/null; then
    git show "$TO_TAG:$file" >"$new_tmp"
  else
    printf '{}' >"$new_tmp"
  fi

  jq -r '.required // [] | .[]' "$old_tmp" | sort -u >"$old_sorted"
  jq -r '.required // [] | .[]' "$new_tmp" | sort -u >"$new_sorted"

  comm -13 "$old_sorted" "$new_sorted" >"$added_tmp" || true
  comm -23 "$old_sorted" "$new_sorted" >"$removed_tmp" || true

  if [[ -s "$added_tmp" || -s "$removed_tmp" ]]; then
    echo
    echo "$file"
    if [[ -s "$added_tmp" ]]; then
      echo "  + required:"
      sed 's/^/    - /' "$added_tmp"
    fi
    if [[ -s "$removed_tmp" ]]; then
      echo "  - required:"
      sed 's/^/    - /' "$removed_tmp"
    fi
  fi

  rm -f "$old_tmp" "$new_tmp" "$old_sorted" "$new_sorted" "$added_tmp" "$removed_tmp"
  trap - RETURN
done
