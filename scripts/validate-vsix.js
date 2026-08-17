"use strict";

const fs = require("fs");
const path = require("path");

const workspaceRoot = path.resolve(__dirname, "..");
const manifest = require(path.join(workspaceRoot, "package.json"));
const artifactPath = path.join(
  workspaceRoot,
  "artifacts",
  `${manifest.name}-${manifest.version}.vsix`,
);

const REQUIRED_FILES = new Set([
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/LICENSE.txt",
  "extension/THIRD_PARTY_LICENSES.txt",
  "extension/changelog.md",
  "extension/package.json",
  "extension/readme.md",
  "extension/dist/extension.js",
  "extension/docs/architecture.md",
  "extension/docs/dashboard-accessibility.md",
  "extension/docs/dashboard-projects.md",
  "extension/docs/dashboard-trends.md",
  "extension/docs/dashboard-workflow.md",
  "extension/docs/debug-tracking.md",
  "extension/docs/git-tracking.md",
  "extension/docs/integration-testing.md",
  "extension/docs/metric-contract.md",
  "extension/docs/performance-budgets.md",
  "extension/docs/storage-v2.md",
  "extension/docs/task-tracking.md",
  "extension/docs/validation.md",
  "extension/docs/webview-testing.md",
  "extension/media/chart.min.js",
  "extension/media/icon.png",
  "extension/media/screenshot-project.png",
  "extension/media/screenshot-session.png",
  "extension/media/webview.css",
  "extension/media/webview.js",
]);

const ALLOWED_FILES = [
  /^\[Content_Types\]\.xml$/,
  /^extension\.vsixmanifest$/,
  /^extension\/(LICENSE\.txt|THIRD_PARTY_LICENSES\.txt|changelog\.md|package\.json|readme\.md)$/,
  /^extension\/dist\/extension\.js$/,
  /^extension\/docs\/[a-z0-9-]+\.md$/,
  /^extension\/media\/(chart\.min\.js|icon\.png|screenshot-[a-z0-9-]+\.png|webview\.css|webview\.js)$/,
];

function main() {
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`VSIX not found: ${path.relative(workspaceRoot, artifactPath)}`);
  }
  const archive = fs.readFileSync(artifactPath);
  const entries = readCentralDirectory(archive);
  const names = new Set(entries.map((entry) => entry.name));

  const duplicateNames = entries
    .map((entry) => entry.name)
    .filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    throw new Error(`Duplicate VSIX entries: ${[...new Set(duplicateNames)].join(", ")}`);
  }
  for (const entry of entries) {
    if (
      entry.name.includes("\\") ||
      entry.name.startsWith("/") ||
      entry.name.split("/").includes("..")
    ) {
      throw new Error(`Unsafe VSIX entry path: ${entry.name}`);
    }
    if (!ALLOWED_FILES.some((pattern) => pattern.test(entry.name))) {
      throw new Error(`Unexpected VSIX entry: ${entry.name}`);
    }
    if (entry.uncompressedSize === 0) {
      throw new Error(`Empty VSIX entry: ${entry.name}`);
    }
  }
  const missing = [...REQUIRED_FILES].filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required VSIX entries: ${missing.join(", ")}`);
  }
  if (entries.length > 50) {
    throw new Error(`VSIX contains ${entries.length} files; expected no more than 50`);
  }
  if (archive.length > 2 * 1024 * 1024) {
    throw new Error(`VSIX is ${(archive.length / 1024 / 1024).toFixed(2)} MiB; limit is 2 MiB`);
  }

  console.log(
    `Validated ${entries.length} VSIX files (${(archive.length / 1024).toFixed(1)} KiB)`,
  );
}

function readCentralDirectory(archive) {
  const endSignature = 0x06054b50;
  const directorySignature = 0x02014b50;
  const minimumEndOffset = Math.max(0, archive.length - 65_557);
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) {
    throw new Error("Invalid VSIX: end-of-central-directory record not found");
  }

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let offset = archive.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== directorySignature) {
      throw new Error(`Invalid VSIX central directory entry at index ${index}`);
    }
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.push({ name, uncompressedSize });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
