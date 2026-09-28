#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const traceFile = process.env.GH_AXI_FAKE_TRACE;
if (!traceFile) throw new Error("GH_AXI_FAKE_TRACE is required");

function optionValue(name) {
  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function repoFromGit() {
  const remote = execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  return remote
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "");
}

function record(kind, repo) {
  appendFileSync(traceFile, `${JSON.stringify({ kind, repo, args })}\n`);
}

if (args[0] === "issue" && args[1] === "view") {
  const repo = optionValue("--repo") ?? repoFromGit();
  record("issue-view", repo);
  console.log(
    JSON.stringify({
      number: 123,
      title: "Fixture issue",
      state: "OPEN",
      author: { login: "fixture-author" },
      createdAt: "2026-09-01T00:00:00Z",
      body: "same payload in every repository",
      issueType: null,
    }),
  );
  process.exit(0);
}

if (args[0] === "api" && args[1] === "graphql") {
  const query = optionValue("-f") ?? "";
  const match = query.match(/repository\(owner: "([^"]+)", name: "([^"]+)"\)/);
  record("graphql", match ? `${match[1]}/${match[2]}` : null);
  console.log(
    JSON.stringify({
      data: {
        repository: {
          issue: { parent: null, subIssues: { totalCount: 0, nodes: [] } },
        },
      },
    }),
  );
  process.exit(0);
}

console.error(`unsupported fake gh invocation: ${args.join(" ")}`);
process.exit(97);
