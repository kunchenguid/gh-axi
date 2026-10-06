#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const stateFile = process.env.GH_AXI_FAKE_STATE;
if (!stateFile) throw new Error("GH_AXI_FAKE_STATE is required");

const state = JSON.parse(readFileSync(stateFile, "utf8"));
const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
  const prefix = `${name}=`;
  const arg = args.find((candidate) => candidate.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function optionValues(name) {
  const values = [];
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name) {
      values.push(args[index + 1]);
      index++;
    } else if (args[index].startsWith(prefix)) {
      values.push(args[index].slice(prefix.length));
    }
  }
  return values;
}

function booleanOption(name) {
  const bare = args.includes(name);
  const value = optionValue(name);
  if (!bare && value === undefined) return undefined;
  return bare || value === "true";
}

function save() {
  writeFileSync(stateFile, JSON.stringify(state), "utf8");
}

function releaseByPath(path) {
  const tagPrefix = "/repos/octo/repo/releases/tags/";
  if (path.startsWith(tagPrefix)) {
    return state.releases.find(
      (release) => release.tag_name === path.slice(tagPrefix.length),
    );
  }
  if (path === "/repos/octo/repo/releases/latest") {
    return state.releases.find(
      (release) => release.tag_name === state.latestTag,
    );
  }
  const idMatch = path.match(/^\/repos\/octo\/repo\/releases\/(\d+)$/);
  if (idMatch) {
    return state.releases.find((release) => release.id === Number(idMatch[1]));
  }
  return undefined;
}

if (args[0] === "release" && args[1] === "edit") {
  const release = state.releases.find(
    (candidate) => candidate.tag_name === args[2],
  );
  if (!release) process.exit(1);

  for (const key of ["prerelease", "draft"]) {
    const value = booleanOption(`--${key}`);
    if (value !== undefined) release[key] = value;
  }
  const latest = booleanOption("--latest");
  if (latest === true) state.latestTag = release.tag_name;
  if (latest === false && state.latestTag === release.tag_name) {
    state.latestTag = state.fallbackLatestTag;
  }
  save();
  console.log(`https://github.com/octo/repo/releases/tag/${release.tag_name}`);
  process.exit(0);
}

if (args[0] === "api") {
  const path = args[1];
  // Mirror gh api: GET normally, POST once a request body is added.
  const method =
    optionValue("--method") ??
    (optionValues("--field").length > 0 || optionValue("--input") !== undefined
      ? "POST"
      : "GET");
  const fields = optionValues("--field").map((field) => {
    const separator = field.indexOf("=");
    const raw = field.slice(separator + 1);
    const value = raw === "true" ? true : raw === "false" ? false : raw;
    return [field.slice(0, separator), value];
  });

  // POST to the collection creates a release, as GitHub's "create a release".
  if (path === "/repos/octo/repo/releases" && method === "POST") {
    const release = {
      id: Math.max(...state.releases.map((r) => r.id)) + 1,
      tag_name: "",
      name: "",
      prerelease: false,
      draft: false,
      ...Object.fromEntries(fields),
    };
    state.releases.push(release);
    save();
    console.log(JSON.stringify(release));
    process.exit(0);
  }

  const release = releaseByPath(path);
  if (!release) {
    console.error("gh: Not Found (HTTP 404)");
    process.exit(1);
  }

  // GitHub updates a release only with PATCH; it has no POST on a single
  // release, so reject it instead of treating it as an update.
  if (method === "PATCH") {
    for (const [key, value] of fields) {
      if (key === "make_latest") {
        if (value === true) state.latestTag = release.tag_name;
        if (value === false && state.latestTag === release.tag_name) {
          state.latestTag = state.fallbackLatestTag;
        }
      } else {
        release[key] = value;
      }
    }
    save();
  } else if (method !== "GET") {
    console.error("gh: Not Found (HTTP 404)");
    process.exit(1);
  }

  console.log(JSON.stringify(release));
  process.exit(0);
}

console.error(`unsupported fake gh invocation: ${args.join(" ")}`);
process.exit(1);
