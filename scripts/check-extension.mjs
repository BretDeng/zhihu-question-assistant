import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const directory = new URL("../extension/", import.meta.url);
for (const name of (await readdir(directory)).filter(name => name.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(name, directory))], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
