/** Read all of this process's stdin as a UTF-8 string. */
export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/** Whether stdin is an interactive terminal (no piped input available). */
export function isStdinTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}
