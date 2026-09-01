import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghJson, ghExec } from '../gh.js';
import { AxiError } from '../errors.js';
import { basename, resolve } from 'node:path';
import { getFlag, hasFlag, takeFlag, takeRequiredFlag, takeBoolFlag, rejectUnknownFlags } from '../args.js';
import {
  field,
  lower,
  pluck,
  relativeTime,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from '../toon.js';
import { formatCountLine } from '../format.js';
import { getSuggestions } from '../suggestions.js';

const REPO_FLAGS: Record<string, readonly string[]> = {
  view: [],
  create: [
    '--public', '--private', '--internal', '--description', '--clone',
    '--template', '--source', '--push', '--remote',
  ],
  edit: [
    '--description', '--visibility', '--default-branch', '--enable-issues',
    '--enable-wiki',
  ],
  clone: [],
  fork: ['--clone', '--remote'],
  list: ['--limit', '--visibility', '--language', '--archived'],
};

export const REPO_HELP = `usage: gh-axi repo <subcommand> [flags]
subcommands[6]:
  view [owner/name], create [name], edit, clone <repo>, fork [repo], list [owner]
flags{view}:
  --repo <owner/name> or exactly one positional owner/name; choose one selector
flags{create}:
  --public, --private, --internal, --description, --clone, --template
  --source <path> (publish existing local repo; name defaults to source dir name), --push, --remote <name> (both require --source)
flags{edit}:
  --description, --visibility, --default-branch, --enable-issues, --enable-wiki
flags{fork}:
  --clone, --remote
flags{list}:
  --limit <n> (default 30), --visibility, --language, --archived
examples:
  gh-axi repo view
  gh-axi repo view --repo owner/name
  gh-axi repo view owner/name
  gh-axi repo create my-project --public --description "A new project"
  gh-axi repo create --public --source . --push
  gh-axi repo list --visibility public --language TypeScript`;

const viewSchema: FieldDef[] = [
  field('name'),
  field('description'),
  pluck('defaultBranchRef', 'name', 'branch'),
  field('stargazerCount', 'stars'),
  field('forkCount', 'forks'),
  custom('issues', (item) => (item.issues as Record<string, unknown> | undefined)?.totalCount ?? 0),
  custom('prs', (item) => (item.pullRequests as Record<string, unknown> | undefined)?.totalCount ?? 0),
  lower('visibility'),
  pluck('primaryLanguage', 'name', 'language'),
];

const listSchema: FieldDef[] = [
  field('name'),
  field('description'),
  lower('visibility'),
  pluck('primaryLanguage', 'name', 'language'),
  field('stargazerCount', 'stars'),
  relativeTime('updatedAt', 'updated'),
];


async function viewRepo(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('-'));
  const repoArg = positionals[1];
  const extraArg = positionals[2];
  if (repoArg && ctx?.source === 'flag') {
    throw new AxiError(
      `Unsupported positional argument for repo view with --repo: ${repoArg}. Use --repo <owner/name> to select a repository.`,
      'VALIDATION_ERROR',
    );
  }
  if (extraArg) {
    throw new AxiError(
      `Unsupported positional argument for repo view: ${extraArg}. Use --repo <owner/name> to select a repository.`,
      'VALIDATION_ERROR',
    );
  }

  const ghArgs = ['repo', 'view'];
  // gh repo view accepts a positional repository; keep that parity only when
  // it does not conflict with gh-axi's command-first --repo targeting.
  if (repoArg) ghArgs.push(repoArg);
  else if (ctx) ghArgs.push(ctx.nwo);
  ghArgs.push('--json', 'name,description,defaultBranchRef,stargazerCount,forkCount,issues,pullRequests,visibility,primaryLanguage');
  const repo = await ghJson<Record<string, unknown>>(ghArgs); // Don't pass ctx — we handle repo arg ourselves

  return renderOutput([
    renderDetail('repo', repo, viewSchema),
  ]);
}

async function createRepo(args: string[], ctx?: RepoContext): Promise<string> {
  // Consume flags destructively so a flag value (e.g. `--source .`) is never
  // mistaken for the name positional.
  const rest = args.slice(1);
  // `--` ends flag parsing; everything after it is positional.
  const sepIdx = rest.indexOf('--');
  const tail = sepIdx === -1 ? [] : rest.splice(sepIdx).slice(1);
  const isPublic = takeBoolFlag(rest, '--public');
  const isPrivate = takeBoolFlag(rest, '--private');
  const isInternal = takeBoolFlag(rest, '--internal');
  const description = takeFlag(rest, '--description');
  const clone = takeBoolFlag(rest, '--clone');
  const template = takeFlag(rest, '--template');
  const source = takeRequiredFlag(rest, '--source');
  const push = takeBoolFlag(rest, '--push');
  const remote = takeRequiredFlag(rest, '--remote');
  const nameIdx = rest.findIndex((a) => !a.startsWith('-'));
  const name = nameIdx === -1 ? tail.shift() : rest.splice(nameIdx, 1)[0];
  const leftovers = [...rest, ...tail];
  if (leftovers.length > 0) {
    throw new AxiError(
      `Unsupported extra argument${leftovers.length > 1 ? 's' : ''} for repo create: ${leftovers.join(', ')}`,
      'VALIDATION_ERROR',
      ['gh-axi repo create --help'],
    );
  }

  if (name !== undefined && name.trim() === '') {
    throw new AxiError('Repository name cannot be blank', 'VALIDATION_ERROR');
  }

  if (source) {
    if (clone) throw new AxiError('--source cannot be combined with --clone', 'VALIDATION_ERROR');
    if (template) throw new AxiError('--source cannot be combined with --template', 'VALIDATION_ERROR');
  } else {
    if (push) throw new AxiError('--push requires --source <path>', 'VALIDATION_ERROR');
    if (remote) throw new AxiError('--remote requires --source <path>', 'VALIDATION_ERROR');
    if (!name) throw new AxiError('Repository name is required: gh-axi repo create <name>', 'VALIDATION_ERROR');
  }

  const ghArgs = ['repo', 'create'];
  const dashLeadingName = name !== undefined && name.startsWith('-');
  if (name && !dashLeadingName) ghArgs.push(name);
  if (isPublic) ghArgs.push('--public');
  else if (isPrivate) ghArgs.push('--private');
  else if (isInternal) ghArgs.push('--internal');
  if (description) ghArgs.push('--description', description);
  if (source) {
    ghArgs.push('--source', source);
    if (remote) ghArgs.push('--remote', remote);
    if (push) ghArgs.push('--push');
  } else {
    if (clone) ghArgs.push('--clone');
    if (template) ghArgs.push('--template', template);
  }
  if (dashLeadingName) ghArgs.push('--', name as string);

  const output = await ghExec(ghArgs);
  const suggestions = getSuggestions({ domain: 'repo', action: 'create', repo: ctx });
  // gh defaults the repo name to the source directory's name and normalizes it
  // (e.g. "my app" -> "my-app"), so prefer the real owner/name from the
  // created-repo URL gh prints; fall back to the raw basename if absent.
  const urlNwo = name
    ? undefined
    : output.match(/https?:\/\/[^/\s]+\/([^/\s]+\/[^/\s]+)/)?.[1];
  const created: Record<string, unknown> = {
    created: 'ok',
    repo: name ?? urlNwo ?? basename(resolve(source as string)),
  };
  if (source) {
    if (isPublic) created.visibility = 'public';
    else if (isPrivate) created.visibility = 'private';
    else if (isInternal) created.visibility = 'internal';
    created.source = source;
    created.remote = remote ?? 'origin';
    created.pushed = push;
  }
  return renderOutput([
    encode(created),
    renderHelp(suggestions),
  ]);
}

async function editRepo(args: string[], ctx?: RepoContext): Promise<string> {
  const ghArgs = ['repo', 'edit'];
  if (ctx && ctx.source !== 'git') ghArgs.push(ctx.nwo);
  const description = getFlag(args, '--description');
  if (description) ghArgs.push('--description', description);
  const visibility = getFlag(args, '--visibility');
  if (visibility) ghArgs.push('--visibility', visibility);
  const defaultBranch = getFlag(args, '--default-branch');
  if (defaultBranch) ghArgs.push('--default-branch', defaultBranch);
  const enableIssues = getFlag(args, '--enable-issues');
  if (enableIssues) ghArgs.push('--enable-issues=' + enableIssues);
  const enableWiki = getFlag(args, '--enable-wiki');
  if (enableWiki) ghArgs.push('--enable-wiki=' + enableWiki);

  await ghExec(ghArgs); // Don't pass ctx — we handle repo arg ourselves
  const suggestions = getSuggestions({ domain: 'repo', action: 'edit', repo: ctx });
  return renderOutput([
    encode({ edit: 'ok' }),
    renderHelp(suggestions),
  ]);
}

async function cloneRepo(args: string[]): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const repo = positionals[1];
  if (!repo) throw new AxiError('Repository is required: gh-axi repo clone <repo>', 'VALIDATION_ERROR');

  await ghExec(['repo', 'clone', repo]);
  const suggestions = getSuggestions({ domain: 'repo', action: 'clone' });
  return renderOutput([
    encode({ clone: 'ok', repo }),
    renderHelp(suggestions),
  ]);
}

async function forkRepo(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const repo = positionals[1]; // optional

  const ghArgs = ['repo', 'fork'];
  if (repo) ghArgs.push(repo);
  if (hasFlag(args, '--clone')) ghArgs.push('--clone');
  if (hasFlag(args, '--remote')) ghArgs.push('--remote');

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'repo', action: 'fork', repo: ctx });
  return renderOutput([
    encode({ fork: 'ok', repo: repo ?? ctx?.nwo ?? 'current' }),
    renderHelp(suggestions),
  ]);
}

async function listRepos(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const owner = positionals[1]; // optional

  const limit = getFlag(args, '--limit') ?? '30';
  const ghArgs = [
    'repo', 'list',
    '--json', 'name,description,visibility,primaryLanguage,stargazerCount,updatedAt',
    '--limit', limit,
  ];
  if (owner) ghArgs.splice(2, 0, owner); // insert owner after 'list'
  const visibility = getFlag(args, '--visibility');
  if (visibility) ghArgs.push('--visibility', visibility);
  const language = getFlag(args, '--language');
  if (language) ghArgs.push('--language', language);
  if (hasFlag(args, '--archived')) ghArgs.push('--archived');

  const repos = await ghJson<Record<string, unknown>[]>(ghArgs);
  const isEmpty = repos.length === 0;
  const limitNum = Number(limit);
  const countLine = formatCountLine({ count: repos.length, limit: limitNum });
  const suggestions = getSuggestions({ domain: 'repo', action: 'list', isEmpty, repo: ctx });
  return renderOutput([
    countLine,
    renderList('repos', repos, listSchema),
    renderHelp(suggestions),
  ]);
}

export async function repoCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];

  if (sub === '--help' || sub === undefined) return REPO_HELP;

  switch (sub) {
    case 'view':
      rejectUnknownFlags(args.slice(1), REPO_FLAGS.view, 'repo', 'view');
      return viewRepo(args, ctx);
    case 'create':
      rejectUnknownFlags(args.slice(1), REPO_FLAGS.create, 'repo', 'create');
      return createRepo(args, ctx);
    case 'edit':
      rejectUnknownFlags(args.slice(1), REPO_FLAGS.edit, 'repo', 'edit');
      return editRepo(args, ctx);
    case 'clone':
      rejectUnknownFlags(args.slice(1), REPO_FLAGS.clone, 'repo', 'clone');
      return cloneRepo(args);
    case 'fork':
      rejectUnknownFlags(args.slice(1), REPO_FLAGS.fork, 'repo', 'fork');
      return forkRepo(args, ctx);
    case 'list':
      rejectUnknownFlags(args.slice(1), REPO_FLAGS.list, 'repo', 'list');
      return listRepos(args, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, 'VALIDATION_ERROR', [
        'Available subcommands: view, create, edit, clone, fork, list',
      ]);
  }
}
