#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
writeFileSync(process.env.GH_AXI_ARGV_FILE, JSON.stringify(args));
if (!args.includes("--allow-escape-sequences")) {
  process.stderr.write(
    "the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway\n",
  );
  process.exit(1);
}
process.stdout.write(
  "\u001b[32mSynthetic job log\u001b[0m\n" + "x".repeat(4100),
);
