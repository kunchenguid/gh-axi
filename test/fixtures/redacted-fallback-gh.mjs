#!/usr/bin/env node
// Synthetic diagnostics only. These values must not reach a CLI consumer.
const credential = "synthetic-fallback-credential-never-use";
const args = process.argv.slice(2);
const fields = args[args.indexOf("--json") + 1] ?? "";
if (args[0] === "issue" && args[1] === "view" && args[2] === "404") {
  process.stderr.write(
    `GraphQL: Could not resolve to an issue or pull request with the number of 404.\n{"password":"${credential}"}\n`,
  );
  process.exitCode = 1;
} else if (
  args[0] === "issue" &&
  args[1] === "view" &&
  fields.includes("issueType")
) {
  process.stderr.write(
    `Unknown JSON field: "issueType"\n{"client_secret":"${credential}"}\n`,
  );
  process.exitCode = 1;
} else if (args[0] === "issue" && args[1] === "view") {
  process.stdout.write(
    JSON.stringify({
      number: 206,
      title: "Safe fallback issue",
      state: "OPEN",
      author: { login: "fixture-author" },
      createdAt: "2026-10-01T00:00:00Z",
      body: "",
    }),
  );
} else if (args[0] === "api" && args[1] === "graphql") {
  process.stderr.write(
    `gh: Could not resolve to an Issue with the number of 206.\n{"temp_clone_token":"${credential}"}\n`,
  );
  process.exitCode = 1;
} else if (args[0] === "project" && args[1] === "field-create") {
  process.stderr.write(
    `GraphQL: Name has already been taken (createProjectV2Field)\n{"private_key":"${credential}"}\n`,
  );
  process.stdout.write(JSON.stringify({ token: credential }));
  process.exitCode = 1;
} else {
  process.stderr.write("Unsupported synthetic fixture invocation\n");
  process.exitCode = 97;
}
