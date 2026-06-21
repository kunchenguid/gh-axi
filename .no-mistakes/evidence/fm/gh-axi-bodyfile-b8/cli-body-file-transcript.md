# gh-axi --body-file E2E transcript

body_file: /Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md
release_notes_file: /Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/release-notes.md

## gh-axi "issue" "--help"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
usage: gh-axi issue <subcommand> [flags]
subcommands[14]:
  list, view <number>, create, edit <number>, close <number>, reopen <number>, comment <number>, delete <number>, lock <number>, unlock <number>, pin <number>, unpin <number>, transfer <number>, subissue <add|remove|list>
flags{list}:
  --state <open|closed|all>, --label <name>, --assignee <login>, --author <login>, --milestone <name>, --sort <created|updated|comments>, --limit <n> (default 30), --fields <a,b,c>
flags{view}:
  --comments, --full (show complete body without truncation)
flags{create}:
  --title <text> (required), --body <text> or --body-file <path>, --assignee <login>, --label <name>, --milestone <name>, --type <name>
flags{edit}:
  --title, --body <text> or --body-file <path>, --add-label, --remove-label, --add-assignee, --remove-assignee, --milestone, --type <name>, --no-type
flags{close}:
  --reason <completed|not_planned>, --comment <text>
flags{comment}:
  --body <text> or --body-file <path> (required)
flags{transfer}:
  --to-repo <owner/name> (required)
subissue:
  add <parent> <child> [<child> ...], remove <parent> <child>, list <parent>
examples:
  gh-axi issue list --state closed --label bug
  gh-axi issue view 42 --comments
  gh-axi issue create --title "Fix login" --body "Steps to reproduce..."
  gh-axi issue comment 42 --body-file comment.md
  gh-axi issue close 42 --reason completed
  gh-axi issue transfer 42 -R source/repo --to-repo dest/repo
  gh-axi issue subissue add 16 20 101 125
  gh-axi issue subissue list 16
```

## gh-axi "pr" "--help"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
usage: gh-axi pr <subcommand> [flags]
subcommands[15]:
  list, view <number>, create, edit <number>, close <number>, merge <number>, review <number>, checks <number>, diff <number>, checkout <number>, ready <number>, reopen <number>, comment <number>, update-branch <number>, revert <number>
flags{list}:
  --state <open|closed|all>, --label, --assignee, --author, --base, --head, --draft, --limit <n> (default 30), --fields <a,b,c>
flags{view}:
  --comments, --reviews (show review submissions and inline review comments), --full (show complete body without truncation)
flags{create}:
  --title <text> (required), --body <text> or --body-file <path>, --base, --head, --draft, --assignee, --reviewer, --label, --milestone
flags{merge}:
  --method <merge|squash|rebase>, --merge, --squash, --rebase, --auto, --delete-branch, --body <text> or --body-file <path>, --subject
flags{review}:
  --approve, --request-changes, --comment, --body <text> or --body-file <path>
flags{checks}:
  (none)
flags{diff}:
  --full (show complete diff without truncation)
examples:
  gh-axi pr list --state open --label bug
  gh-axi pr view 42 --comments
  gh-axi pr view 42 --reviews
  gh-axi pr comment 42 --body-file review.md
  gh-axi pr merge 42 --squash --delete-branch
```

## gh-axi "release" "--help"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
usage: gh-axi release <subcommand> [flags]
subcommands[7]:
  list, view <tag>, create <tag>, edit <tag>, delete <tag>, download <tag>, upload <tag>
flags{list}:
  --exclude-drafts, --exclude-pre-releases, --limit (default 10)
flags{view}:
  --full (show complete release notes without truncation)
flags{create}:
  --title/-t, --notes/-n or --body, --notes-file/-F or --body-file, --draft/-d, --prerelease/-p, --target, --generate-notes, --discussion-category, --notes-start-tag, --verify-tag, --notes-from-tag, --fail-on-no-commits, --latest[=true|false], <files...>
flags{edit}:
  --title, --notes/-n or --body, --notes-file/-F or --body-file, --draft, --prerelease
flags{download}:
  --pattern, --dir
examples:
  gh-axi release list --exclude-drafts
  gh-axi release view v1.2.0 --full
  gh-axi release create v1.3.0 --body-file notes.md --draft dist/app.zip
```

## gh-axi "pr" "create" "--title" "E2E body-file PR" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
created:
  number: 123
  url: "https://github.com/octo/repo/pull/123"
help[2]:
  Run `gh-axi pr view 123` to see the full PR
  Run `gh-axi pr checks 123` to monitor CI

```

## gh-axi "pr" "edit" "123" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
edited:
  number: 123
  status: ok

```

## gh-axi "pr" "review" "123" "--comment" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
review:
  number: 123
  action: commented
help[1]:
  Run `gh-axi pr view 123` to see PR details

```

## gh-axi "pr" "comment" "123" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
commented:
  number: 123
  status: ok
help[1]:
  Run `gh-axi pr view 123 --comments` to see all comments

```

## gh-axi "pr" "merge" "123" "--squash" "--delete-branch" "--subject" "Squash subject" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
merged:
  number: 123
  status: ok
  method: squash
help[1]:
  Run `gh-axi pr revert 123` to revert if needed

```

## gh-axi "issue" "create" "--title" "E2E body-file issue" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
issue:
  number: 99
  title: E2E body-file issue
  state: open
  url: "https://github.com/octo/repo/issues/99"
help[2]:
  Run `gh-axi issue view 99` to see the full issue
  Run `gh-axi issue edit 99 --add-label <label>` to label

```

## gh-axi "issue" "edit" "99" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
issue:
  number: 99
  title: E2E body-file issue
  state: open
  labels: none
  assignees: none
help[1]:
  Run `gh-axi issue view 99` to see updated issue

```

## gh-axi "issue" "comment" "99" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
comment:
  issue: 99
  author: octocat
  created: 2m ago
  body: latest comment returned after --body-file post
help[1]:
  Run `gh-axi issue view 99 --comments` to see all comments

```

## gh-axi "release" "create" "v9.9.9-bodyfile" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/release-notes.md" "--draft" "dist/app.zip"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
created: ok
tag: v9.9.9-bodyfile
help[2]:
  Run `gh-axi release view v9.9.9-bodyfile` to view the release
  Run `gh-axi release upload v9.9.9-bodyfile <files...>` to upload assets

```

## gh-axi "release" "edit" "v9.9.9-bodyfile" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/release-notes.md" "--title" "Retitled release"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
edit: ok
tag: v9.9.9-bodyfile
help[1]:
  Run `gh-axi release view v9.9.9-bodyfile` to see updated release

```

## gh-axi "pr" "comment" "123" "--body" "inline body" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/body.md"

expected_exit_code: 2
exit_code: 2

stdout:

```toon
error: "Use only one body source: --body, --body-file were provided"
code: VALIDATION_ERROR
help[1]: "Use --body \"...\" for inline body, or --body-file <path> for markdown from a file"

```

## gh-axi "issue" "comment" "99" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/missing.md"

expected_exit_code: 2
exit_code: 2

stdout:

```toon
error: "--body-file path not found: /Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/missing.md"
code: VALIDATION_ERROR
help[1]: "Use --body \"...\" for inline body, or --body-file <path> for markdown from a file"

```

## gh-axi "release" "edit" "v9.9.9-bodyfile" "--body-file" "/Users/kunchen/.no-mistakes/worktrees/21c6d0f851bd/01KVP0MQVZ83MNTJK3C3MJTYFS/.no-mistakes/evidence/fm/gh-axi-bodyfile-b8/release-notes.md" "--notes-file" "other-notes.md"

expected_exit_code: 2
exit_code: 2

stdout:

```toon
error: "Use only one release notes source: --body/--body-file cannot be combined with --notes-file"
code: VALIDATION_ERROR
help[1]: "Use --body-file <path> for file-backed release notes, or remove --body-file and use --notes-file <path>"

```

## gh-axi "pr" "comment" "123" "--body" "- dash-leading inline body\n- still inline"

expected_exit_code: 0
exit_code: 0

stdout:

```toon
commented:
  number: 123
  status: ok
help[1]:
  Run `gh-axi pr view 123 --comments` to see all comments

```
