#!/bin/sh
set -eu

evidence_dir=".no-mistakes/evidence/fm/gh-axi-argfix-r3"
transcript="$evidence_dir/cli-e2e-transcript.txt"
arg_log="$evidence_dir/gh-argv.jsonl"
fake_bin="$PWD/$evidence_dir/fake-bin"

: > "$transcript"
: > "$arg_log"

run_case() {
  printf '$ %s\n' "$*" >> "$transcript"
  GH_AXI_ARG_LOG="$PWD/$arg_log" PATH="$fake_bin:$PATH" "$@" >> "$transcript" 2>&1
  printf '\n' >> "$transcript"
}

run_case pnpm exec tsx bin/gh-axi.ts release create v1.2.3 --repo octo/release-target --target main --title "Ship 1.2.3" --notes "hello notes" dist/app.zip
run_case pnpm exec tsx bin/gh-axi.ts release create v1.2.4 --repo=octo/equals-target --target=main --notes-file=notes.md --discussion-category=Announcements --notes-start-tag v1.2.0 dist/app.zip
run_case pnpm exec tsx bin/gh-axi.ts pr merge 42 --repo octo/pr-target --squash --delete-branch

printf 'Recorded gh argv:\n' >> "$transcript"
node -e "const fs=require('fs'); for (const line of fs.readFileSync(process.argv[1], 'utf8').trim().split(/\\n/)) console.log(JSON.stringify(JSON.parse(line), null, 2));" "$arg_log" >> "$transcript"
