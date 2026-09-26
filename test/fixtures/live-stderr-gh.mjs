#!/usr/bin/env node

import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const releaseFile = process.env["GH_AXI_FAKE_RELEASE"];
if (!releaseFile) {
  process.stderr.write("GH_AXI_FAKE_RELEASE is required\n");
  process.exit(2);
}

process.stderr.write("Vault approval required for test request\n");
while (!existsSync(releaseFile)) {
  await delay(10);
}

process.stdout.write("fake stdout retained\n");
process.stderr.write("HTTP 403: Forbidden\n");
process.exitCode = 7;
