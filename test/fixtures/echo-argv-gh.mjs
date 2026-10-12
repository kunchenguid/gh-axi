#!/usr/bin/env node

// Fake gh: print the argv it received as JSON on stdout.
process.stdout.write(`${JSON.stringify(process.argv.slice(2))}\n`);
