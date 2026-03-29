import { describe, it, expect } from 'vitest';
import { ISSUE_HELP } from '../src/commands/issue.js';
import { PR_HELP } from '../src/commands/pr.js';
import { RUN_HELP } from '../src/commands/run.js';
import { WORKFLOW_HELP } from '../src/commands/workflow.js';
import { RELEASE_HELP } from '../src/commands/release.js';
import { REPO_HELP } from '../src/commands/repo.js';
import { LABEL_HELP } from '../src/commands/label.js';
import { SEARCH_HELP } from '../src/commands/search.js';
import { API_HELP } from '../src/commands/api.js';
import { TOP_HELP } from '../src/cli.js';

/**
 * Every HELP constant must contain an "examples:" section with at least 2
 * concrete usage examples that start with "gh-axi".
 */
function assertHelpHasExamples(name: string, help: string) {
  describe(`${name}`, () => {
    it('contains an examples: section', () => {
      expect(help).toContain('examples:');
    });

    it('has at least 2 examples starting with "gh-axi"', () => {
      const examplesSection = help.slice(help.indexOf('examples:'));
      const exampleLines = examplesSection
        .split('\n')
        .filter((line) => line.trim().startsWith('gh-axi'));
      expect(exampleLines.length).toBeGreaterThanOrEqual(2);
    });

    it('examples are indented with 2 spaces', () => {
      const examplesSection = help.slice(help.indexOf('examples:'));
      const exampleLines = examplesSection
        .split('\n')
        .filter((line) => line.trim().startsWith('gh-axi'));
      for (const line of exampleLines) {
        expect(line).toMatch(/^  gh-axi/);
      }
    });
  });
}

describe('Help output includes examples for every command family', () => {
  assertHelpHasExamples('TOP_HELP', TOP_HELP);
  assertHelpHasExamples('ISSUE_HELP', ISSUE_HELP);
  assertHelpHasExamples('PR_HELP', PR_HELP);
  assertHelpHasExamples('RUN_HELP', RUN_HELP);
  assertHelpHasExamples('WORKFLOW_HELP', WORKFLOW_HELP);
  assertHelpHasExamples('RELEASE_HELP', RELEASE_HELP);
  assertHelpHasExamples('REPO_HELP', REPO_HELP);
  assertHelpHasExamples('LABEL_HELP', LABEL_HELP);
  assertHelpHasExamples('SEARCH_HELP', SEARCH_HELP);
  assertHelpHasExamples('API_HELP', API_HELP);
});
