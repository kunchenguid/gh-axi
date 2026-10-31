#!/usr/bin/env node
// Synthetic child diagnostics deliberately split across chunks while pending.
const response = process.env.GH_AXI_METADATA_RESPONSE;
process.stderr.write(response.slice(0, 24));
setTimeout(() => process.stderr.write(response.slice(24)), 20);
setTimeout(() => {
  process.stdout.write(response);
  process.exit(Number(process.env.GH_AXI_METADATA_EXIT ?? 0));
}, 1300);
