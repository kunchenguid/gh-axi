#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(process.env.GH_AXI_ARGV_FILE, `${JSON.stringify(args)}\n`);

if (args[0] !== "pr" || args[1] !== "view") process.exit(1);

const pr = {
  number: 42,
  title: "Selected PR",
  headRefOid: "0123456789abcdef0123456789abcdef01234567",
  reviews: [
    {
      id: "PRR_1",
      author: { login: "reviewer" },
      state: "APPROVED",
      body: "Review text\n".repeat(100),
      submittedAt: "2026-10-01T12:00:00Z",
      commit: { oid: "0123456789abcdef0123456789abcdef01234567" },
    },
  ],
  milestone: null,
};
const fields = args[args.indexOf("--json") + 1].split(",");
process.stdout.write(
  JSON.stringify(Object.fromEntries(fields.map((key) => [key, pr[key]]))),
);
