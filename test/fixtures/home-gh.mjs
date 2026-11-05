#!/usr/bin/env node

const command = process.argv[2];
if (!["issue", "pr"].includes(command) || process.argv[3] !== "list") {
  process.stderr.write("Unexpected fake gh invocation\n");
  process.exit(2);
}

const response = JSON.parse(process.env.GH_AXI_HOME_RESPONSES)[command];
if (typeof response === "string") {
  process.stderr.write(response);
  process.exit(1);
}
process.stdout.write(JSON.stringify(response));
