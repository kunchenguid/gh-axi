#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const traceFile = process.env.GH_AXI_FAKE_GIT_TRACE;
if (!traceFile) throw new Error("GH_AXI_FAKE_GIT_TRACE is required");
appendFileSync(traceFile, `${JSON.stringify(args)}\n`);

if (args.join(" ") === "remote get-url origin") {
  console.log(`https://github.com/${process.env.GH_AXI_FAKE_ORIGIN}.git`);
  process.exit(0);
}

console.error(`unsupported fake git invocation: ${args.join(" ")}`);
process.exit(98);
