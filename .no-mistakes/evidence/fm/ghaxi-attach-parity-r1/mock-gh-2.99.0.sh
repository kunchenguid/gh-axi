#!/bin/sh
set -eu
printf '%s\n' "$*" >> "${GH_MOCK_CALL_LOG:?}"
if [ "${1:-}" = "--version" ]; then
  printf 'gh version 2.99.0 (2026-04-01)\n'
  exit 0
fi
if [ "${1:-}" = "issue" ] && [ "${2:-}" = "create" ]; then
  printf 'https://github.com/octo/repo/issues/99\n'
  if [ "${GH_MOCK_MODE:-success}" = "partial" ]; then
    printf '%s\n' 'oversized.png: images must be at most 10.0 MB' >&2
    exit 1
  fi
  exit 0
fi
if [ "${1:-}" = "issue" ] && [ "${2:-}" = "view" ]; then
  printf '%s\n' '{"number":99,"title":"UI bug","state":"OPEN","url":"https://github.com/octo/repo/issues/99","body":"![uploaded](https://github.com/user-attachments/assets/11111111-2222-3333-4444-555555555555)"}'
  exit 0
fi
printf 'unexpected mock gh invocation: %s\n' "$*" >&2
exit 2
