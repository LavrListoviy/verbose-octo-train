import { spawnSync } from "node:child_process";
import process from "node:process";

const composeFile = "docker-compose.integration.yml";
const composeArgs = ["compose", "-f", composeFile];

function runDocker(args) {
  if (process.platform !== "win32") {
    return spawnSync("docker", args, { cwd: process.cwd(), stdio: "inherit" });
  }

  const linuxCwd = process.cwd().replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll("\\", "/");
  return spawnSync(
    "wsl.exe",
    [
      "--distribution",
      "Ubuntu-24.04",
      "--user",
      "root",
      "--cd",
      linuxCwd,
      "--",
      "docker",
      ...args,
    ],
    { stdio: "inherit" },
  );
}

const result = runDocker([
  ...composeArgs,
  "up",
  "--build",
  "--abort-on-container-exit",
  "--exit-code-from",
  "integration-tests",
]);

if (result.status !== 0) {
  runDocker([...composeArgs, "logs", "--no-color"]);
}

const cleanup = runDocker([...composeArgs, "down", "--volumes", "--remove-orphans"]);
if (cleanup.status !== 0) {
  console.error("Failed to clean up the integration test environment");
}

process.exitCode = result.status ?? 1;
