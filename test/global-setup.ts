import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

export default function setup(project: TestProject): void {
  function build(): void {
    execFileSync("npm", ["run", "build"], {
      cwd: project.config.root,
      stdio: "inherit",
    });
  }

  build();
  project.onTestsRerun(build);
}
