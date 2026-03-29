import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghJson, ghExec } from '../gh.js';
import { AxiError } from '../errors.js';
import { getFlag, hasFlag, getAllFlags } from '../args.js';
import {
  field,
  lower,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from '../toon.js';
import { formatCountLine } from '../format.js';
import { getSuggestions } from '../suggestions.js';

export const WORKFLOW_HELP = `usage: gh-axi workflow <subcommand> [flags]
subcommands[5]:
  list, view <id|name>, run <id|name>, enable <id|name>, disable <id|name>
flags{list}:
  --limit <n> (default 20), --all
flags{run}:
  --ref <git-ref>, --field <key=val> (repeatable)
examples:
  gh-axi workflow list
  gh-axi workflow run ci.yml --ref main
  gh-axi workflow disable 12345`;

const listSchema: FieldDef[] = [
  field('id'),
  field('name'),
  lower('state'),
  field('path'),
];

const viewSchema: FieldDef[] = [
  field('id'),
  field('name'),
  lower('state'),
  field('path'),
];


async function findWorkflow(id: string, ctx?: RepoContext): Promise<Record<string, unknown>> {
  const workflows = await ghJson<Record<string, unknown>[]>(
    ['workflow', 'list', '--json', 'id,name,state,path', '--all'],
    ctx,
  );
  const match = workflows.find(
    (w) => String(w.id) === id || w.name === id || (typeof w.name === 'string' && w.name.toLowerCase() === id.toLowerCase()),
  );
  if (!match) throw new AxiError(`Workflow "${id}" not found`, 'NOT_FOUND');
  return match;
}

async function listWorkflows(args: string[], ctx?: RepoContext): Promise<string> {
  const limit = getFlag(args, '--limit') ?? '20';
  const ghArgs = [
    'workflow', 'list',
    '--json', 'id,name,state,path',
    '--limit', limit,
  ];
  if (hasFlag(args, '--all')) ghArgs.push('--all');

  const workflows = await ghJson<Record<string, unknown>[]>(ghArgs, ctx);
  const isEmpty = workflows.length === 0;
  const limitNum = Number(limit);
  const countLine = formatCountLine({ count: workflows.length, limit: limitNum });
  const suggestions = getSuggestions({ domain: 'workflow', action: 'list', isEmpty, repo: ctx });
  return renderOutput([
    countLine,
    renderList('workflows', workflows, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewWorkflow(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Workflow ID or name is required: gh-axi workflow view <id|name>', 'VALIDATION_ERROR');

  const match = await findWorkflow(id, ctx);

  return renderOutput([renderDetail('workflow', match, viewSchema)]);
}

async function runWorkflow(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Workflow ID or name is required: gh-axi workflow run <id|name>', 'VALIDATION_ERROR');

  const ghArgs = ['workflow', 'run', id];
  const ref = getFlag(args, '--ref');
  if (ref) ghArgs.push('--ref', ref);
  const fields = getAllFlags(args, '--field');
  for (const f of fields) {
    ghArgs.push('--field', f);
  }

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'workflow', action: 'run', id, repo: ctx });
  return renderOutput([
    encode({ triggered: 'ok', workflow: id }),
    renderHelp(suggestions),
  ]);
}

async function enableWorkflow(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Workflow ID or name is required: gh-axi workflow enable <id|name>', 'VALIDATION_ERROR');

  // Idempotent: check current state before enabling
  const match = await findWorkflow(id, ctx);

  if (match.state === 'active') {
    const suggestions = getSuggestions({ domain: 'workflow', action: 'enable', id, repo: ctx });
    return renderOutput([
      encode({ enable: 'already_enabled', workflow: id }),
      renderHelp(suggestions),
    ]);
  }

  await ghExec(['workflow', 'enable', id], ctx);
  const suggestions = getSuggestions({ domain: 'workflow', action: 'enable', id, repo: ctx });
  return renderOutput([
    encode({ enable: 'ok', workflow: id }),
    renderHelp(suggestions),
  ]);
}

async function disableWorkflow(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Workflow ID or name is required: gh-axi workflow disable <id|name>', 'VALIDATION_ERROR');

  // Idempotent: check current state before disabling
  const match = await findWorkflow(id, ctx);

  if (match.state === 'disabled_manually') {
    const suggestions = getSuggestions({ domain: 'workflow', action: 'disable', id, repo: ctx });
    return renderOutput([
      encode({ disable: 'already_disabled', workflow: id }),
      renderHelp(suggestions),
    ]);
  }

  await ghExec(['workflow', 'disable', id], ctx);
  const suggestions = getSuggestions({ domain: 'workflow', action: 'disable', id, repo: ctx });
  return renderOutput([
    encode({ disable: 'ok', workflow: id }),
    renderHelp(suggestions),
  ]);
}

export async function workflowCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];

  if (sub === '--help' || sub === undefined) return WORKFLOW_HELP;

  switch (sub) {
    case 'list':
      return listWorkflows(args, ctx);
    case 'view':
      return viewWorkflow(args, ctx);
    case 'run':
      return runWorkflow(args, ctx);
    case 'enable':
      return enableWorkflow(args, ctx);
    case 'disable':
      return disableWorkflow(args, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, 'VALIDATION_ERROR', [
        'Available subcommands: list, view, run, enable, disable',
      ]);
  }
}
