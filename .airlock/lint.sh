#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${AIRLOCK_BASE_SHA:-}" || -z "${AIRLOCK_HEAD_SHA:-}" ]]; then
  echo "AIRLOCK_BASE_SHA and AIRLOCK_HEAD_SHA must be set" >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

changed_files=()
while IFS= read -r file; do
  changed_files+=("$file")
done < <(git diff --name-only --diff-filter=ACMR "$AIRLOCK_BASE_SHA" "$AIRLOCK_HEAD_SHA")

if ((${#changed_files[@]} == 0)); then
  exit 0
fi

prettier_files=()
eslint_files=()
has_typescript_changes=0

for file in "${changed_files[@]}"; do
  [[ -f "$file" ]] || continue

  case "$file" in
    *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md|*.yml|*.yaml)
      prettier_files+=("$file")
      ;;
  esac

  case "$file" in
    *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs)
      eslint_files+=("$file")
      ;;
  esac

  case "$file" in
    *.ts|*.tsx|*.mts|*.cts)
      has_typescript_changes=1
      ;;
  esac
done

if ((${#prettier_files[@]} > 0)); then
  npx prettier --write "${prettier_files[@]}"
fi

if ((${#eslint_files[@]} > 0)) && [[ -f eslint.config.mjs ]]; then
  npx eslint --fix "${eslint_files[@]}"
fi

if ((${#prettier_files[@]} > 0)); then
  npx prettier --check "${prettier_files[@]}"
fi

if ((${#eslint_files[@]} > 0)) && [[ -f eslint.config.mjs ]]; then
  npx eslint "${eslint_files[@]}"
fi

if ((has_typescript_changes)); then
  npx tsc --noEmit
fi
