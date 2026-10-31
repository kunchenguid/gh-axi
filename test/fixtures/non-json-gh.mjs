#!/usr/bin/env node
if (process.argv[2] === "--version") {
  console.log("gh version 2.99.0");
} else {
  process.stdout.write(process.env.GH_AXI_FAKE_OUTPUT ?? "");
}
