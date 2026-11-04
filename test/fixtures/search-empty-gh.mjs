#!/usr/bin/env node
import { appendFileSync } from "node:fs";

appendFileSync(
  process.env.GH_AXI_SEARCH_ARGV,
  JSON.stringify(process.argv.slice(2)) + "\n",
);
console.log("[]");
