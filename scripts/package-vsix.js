"use strict";

const fs = require("fs");
const path = require("path");
const { createVSIX } = require("@vscode/vsce");

const workspaceRoot = path.resolve(__dirname, "..");
const manifest = require(path.join(workspaceRoot, "package.json"));
const artifactDirectory = path.join(workspaceRoot, "artifacts");
const artifactPath = path.join(
  artifactDirectory,
  `${manifest.name}-${manifest.version}.vsix`,
);

async function main() {
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.rmSync(artifactPath, { force: true });
  await createVSIX({
    cwd: workspaceRoot,
    packagePath: artifactPath,
    dependencies: false,
  });
  console.log(`Created ${path.relative(workspaceRoot, artifactPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
