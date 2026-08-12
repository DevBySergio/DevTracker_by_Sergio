const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const vscodeExecutablePath = [
    "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron",
  ].find((candidate) => fs.existsSync(candidate));
  if (!vscodeExecutablePath) {
    throw new Error("A local Visual Studio Code executable was not found");
  }
  const sandbox = fs.mkdtempSync(path.join("/tmp", "dt-it-"));
  const workspace = path.join(sandbox, "workspace");
  const userData = path.join(sandbox, "user-data");
  const extensions = path.join(sandbox, "extensions");
  const testHome = path.join(sandbox, "home");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(testHome, { recursive: true });
  fs.writeFileSync(path.join(workspace, "tracked.ts"), "export {};\n");
  execFileSync("git", ["init", workspace], { stdio: "ignore" });
  execFileSync("git", ["-C", workspace, "symbolic-ref", "HEAD", "refs/heads/main"]);
  execFileSync("git", ["-C", workspace, "config", "user.email", "devtracker@example.invalid"]);
  execFileSync("git", ["-C", workspace, "config", "user.name", "DevTracker Test"]);
  execFileSync("git", ["-C", workspace, "add", "tracked.ts"]);
  execFileSync("git", ["-C", workspace, "commit", "-m", "Initial fixture"], {
    stdio: "ignore",
  });
  const today = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const localDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const legacyDirectory = path.join(testHome, ".devtracker");
  fs.mkdirSync(legacyDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDirectory, "data.json"),
    JSON.stringify({
      dailyGoal: 14_400,
      projects: {
        [workspace]: {
          name: path.basename(workspace),
          path: workspace,
          days: {
            [localDate]: {
              date: localDate,
              seconds: 5,
              focusSeconds: 5,
              languages: { typescript: { name: "typescript", seconds: 5 } },
              hours: {},
              files: {},
            },
          },
        },
      },
    }),
  );

  try {
    const options = {
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath: path.join(
        extensionDevelopmentPath,
        "out",
        "test",
        "integration",
        "run.js",
      ),
      extensionTestsEnv: {
        HOME: testHome,
        DEVTRACKER_INTEGRATION_PHASE: "record",
      },
      launchArgs: [
        workspace,
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--user-data-dir",
        userData,
        "--extensions-dir",
        extensions,
      ],
    };
    await runTests(options);
    await runTests({
      ...options,
      extensionTestsEnv: {
        ...options.extensionTestsEnv,
        DEVTRACKER_INTEGRATION_PHASE: "reload",
      },
    });
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
