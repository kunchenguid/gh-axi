#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EVIDENCE_DIR="$ROOT/.no-mistakes/evidence/fm/gh-axi-project-p8"
TRANSCRIPT="$EVIDENCE_DIR/project-cli-e2e-transcript.txt"
ARGV_LOG="$EVIDENCE_DIR/gh-argv.jsonl"
FAKE_BIN="$EVIDENCE_DIR/fake-bin"

cd "$ROOT"
rm -f "$TRANSCRIPT" "$ARGV_LOG"

export PATH="$FAKE_BIN:$PATH"
export GH_AXI_FAKE_LOG="$ARGV_LOG"
unset GH_REPO
unset GH_HOST

run() {
  local status
  {
    printf '\n$ gh-axi %s\n' "$*"
  } >>"$TRANSCRIPT"

  pnpm exec tsx bin/gh-axi.ts "$@" >>"$TRANSCRIPT" 2>&1
  status=$?

  {
    printf '[exit %s]\n' "$status"
  } >>"$TRANSCRIPT"
}

{
  printf '# gh-axi project CLI evidence\n'
  printf 'The child gh executable is a deterministic stub that records argv and returns representative gh project JSON.\n'
  printf 'This exercises the real gh-axi entrypoint, argument parsing, TOON rendering, child process execution, and gh error mapping.\n'
} >"$TRANSCRIPT"

run project --help
run project list -R octo/repo
run project view 3 --owner octo
run project item-list 3 --owner octo --query status:Todo
run project field-list 3 --owner octo
run project item-add 3 --owner octo --url https://github.com/octo/repo/issues/42
run project item-create 3 --owner octo --title "Draft note" --body "details"
run project item-edit --id PVTI_1 --project-id PVT_3 --field-id STATUS --text Done
run project item-archive 3 --owner octo --id PVTI_1
run project item-delete 3 --owner octo --id PVTI_2
run project create --owner octo --title Roadmap
run project edit 3 --owner octo --title "Roadmap 2026" --visibility PRIVATE
run project close 3 --owner octo
run project close 4 --owner octo
run project copy 3 --source-owner octo --target-owner dest --title "Copied Roadmap" --drafts
run project list --owner scope-missing

{
  printf '\n# Recorded child gh argv\n'
  cat "$ARGV_LOG"
} >>"$TRANSCRIPT"

printf '%s\n' "$TRANSCRIPT"
