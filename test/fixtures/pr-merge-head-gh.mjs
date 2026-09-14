#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const logFile = process.env.GH_AXI_ARGV_FILE;
if (logFile) appendFileSync(logFile, `${JSON.stringify(args)}\n`);

function optionValue(name) {
  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

if (args[0] === "pr" && args[1] === "view") {
  process.stdout.write('{"state":"OPEN"}\n');
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "merge") {
  if (optionValue("--match-head-commit") !== process.env.GH_AXI_EXPECTED_HEAD) {
    process.stderr.write(
      "refusing merge: reviewed commit does not match current pull request head\n",
    );
    process.exit(1);
  }
  process.exit(0);
}

process.stderr.write(`unsupported fake gh invocation: ${args.join(" ")}\n`);
process.exit(1);
