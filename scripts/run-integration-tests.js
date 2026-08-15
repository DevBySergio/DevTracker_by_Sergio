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
  const emptyWorkspace = path.join(sandbox, "empty-workspace");
  const gitWorkspace = path.join(sandbox, "git-project");
  const plainWorkspace = path.join(sandbox, "plain-project");
  const workspaceFile = path.join(sandbox, "devtracker.code-workspace");
  const emptyProfile = profilePaths(sandbox, "empty");
  const recordProfile = profilePaths(sandbox, "record");

  fs.mkdirSync(emptyWorkspace, { recursive: true });
  fs.mkdirSync(gitWorkspace, { recursive: true });
  fs.mkdirSync(plainWorkspace, { recursive: true });
  Object.values(emptyProfile).forEach((directory) =>
    fs.mkdirSync(directory, { recursive: true }),
  );
  Object.values(recordProfile).forEach((directory) =>
    fs.mkdirSync(directory, { recursive: true }),
  );
  fs.writeFileSync(path.join(gitWorkspace, "tracked.ts"), "export {};\n");
  fs.writeFileSync(path.join(gitWorkspace, "second.ts"), "export {};\n");
  fs.writeFileSync(path.join(plainWorkspace, "plain.ts"), "export {};\n");
  fs.writeFileSync(path.join(emptyWorkspace, "empty.ts"), "export {};\n");
  fs.writeFileSync(
    workspaceFile,
    JSON.stringify({
      folders: [
        { name: "git-project", path: gitWorkspace },
        { name: "plain-project", path: plainWorkspace },
      ],
      settings: {},
    }),
  );

  execFileSync("git", ["init", gitWorkspace], { stdio: "ignore" });
  execFileSync("git", [
    "-C",
    gitWorkspace,
    "symbolic-ref",
    "HEAD",
    "refs/heads/main",
  ]);
  execFileSync("git", [
    "-C",
    gitWorkspace,
    "config",
    "user.email",
    "devtracker@example.invalid",
  ]);
  execFileSync("git", [
    "-C",
    gitWorkspace,
    "config",
    "user.name",
    "DevTracker Test",
  ]);
  execFileSync("git", ["-C", gitWorkspace, "add", "tracked.ts", "second.ts"]);
  execFileSync("git", ["-C", gitWorkspace, "commit", "-m", "Initial fixture"], {
    stdio: "ignore",
  });
  createLegacyFixture(recordProfile.home, gitWorkspace);

  try {
    await runTests(
      testOptions({
        vscodeExecutablePath,
        extensionDevelopmentPath,
        workspace: emptyWorkspace,
        profile: emptyProfile,
        phase: "empty",
        disableGit: true,
      }),
    );
    const recordOptions = testOptions({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      workspace: workspaceFile,
      profile: recordProfile,
      phase: "record",
    });
    await runTests(recordOptions);
    await runTests({
      ...recordOptions,
      extensionTestsEnv: {
        ...recordOptions.extensionTestsEnv,
        DEVTRACKER_INTEGRATION_PHASE: "reload",
      },
    });
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function profilePaths(sandbox, name) {
  return {
    userData: path.join(sandbox, `${name}-user-data`),
    extensions: path.join(sandbox, `${name}-extensions`),
    home: path.join(sandbox, `${name}-home`),
  };
}

function testOptions({
  vscodeExecutablePath,
  extensionDevelopmentPath,
  workspace,
  profile,
  phase,
  disableGit = false,
}) {
  return {
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
      HOME: profile.home,
      DEVTRACKER_INTEGRATION_PHASE: phase,
    },
    launchArgs: [
      workspace,
      "--disable-extensions",
      ...(disableGit ? ["--disable-extension", "vscode.git"] : []),
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--user-data-dir",
      profile.userData,
      "--extensions-dir",
      profile.extensions,
    ],
  };
}

function createLegacyFixture(testHome, workspace) {
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
          name: "git-project",
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
