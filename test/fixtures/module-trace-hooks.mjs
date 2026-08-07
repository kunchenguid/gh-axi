// `load` hook that records every module URL Node actually loads, so a test can
// assert which parts of the module graph an entrypoint pulls in.
// Registered by `module-trace-register.mjs` via `node --import`.
import { appendFileSync } from "node:fs";

const traceFile = process.env["GH_AXI_MODULE_TRACE_FILE"];

export async function load(url, context, nextLoad) {
  if (traceFile) {
    appendFileSync(traceFile, `${url}\n`);
  }
  return nextLoad(url, context);
}
