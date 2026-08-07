import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createEmptyDailyRollup } from "../domain/schemaV2";
import { UriIdentityService } from "../identity/UriIdentityService";
import {
  SchemaValidationError,
  assertDailyRollup,
  assertDocumentIdentity,
} from "../persistence/schemaV2Validation";
import {
  Clock,
  FileSystemAdapter,
  nodeFileSystem,
} from "../platform/ports";

suite("URI identity", () => {
  const nowMs = Date.UTC(2026, 7, 7, 12, 0, 0);
  const clock: Clock = {
    now: () => new Date(nowMs),
    nowMs: () => nowMs,
  };

  test("uses realpath and preserves POSIX path case", () => {
    const fileSystem: FileSystemAdapter = {
      ...nodeFileSystem,
      realpathSync: () => "/Real/Workspace/App",
    };
    const service = new UriIdentityService({
      clock,
      fileSystem,
      platform: "linux",
    });

    const identity = service.createProjectIdentity(
      {
        scheme: "file",
        authority: "",
        path: "/alias/app",
        fsPath: "/alias/app",
      },
      "App",
    );

    assert.strictEqual(identity.canonicalUri, "file:///Real/Workspace/App");
    assert.strictEqual(identity.id.length, "project-".length + 64);
  });

  test("normalizes only the drive letter on Windows", () => {
    const service = createFallbackService("win32");
    const upperDrive = service.createProjectIdentity(
      fileInput("C:\\Work\\App"),
      "App",
    );
    const lowerDrive = service.createProjectIdentity(
      fileInput("c:\\Work\\App"),
      "App",
    );
    const differentPathCase = service.createProjectIdentity(
      fileInput("c:\\work\\App"),
      "App",
    );

    assert.strictEqual(upperDrive.id, lowerDrive.id);
    assert.notStrictEqual(upperDrive.id, differentPathCase.id);
  });

  test("keeps same-named projects and POSIX case variants distinct", () => {
    const service = createFallbackService("linux");
    const first = service.createProjectIdentity(
      fileInput("/work/alpha/app"),
      "app",
    );
    const second = service.createProjectIdentity(
      fileInput("/work/beta/app"),
      "app",
    );
    const caseVariant = service.createProjectIdentity(
      fileInput("/work/alpha/App"),
      "App",
    );

    assert.notStrictEqual(first.id, second.id);
    assert.notStrictEqual(first.id, caseVariant.id);
  });

  test("supports remote and virtual workspace URI schemes without realpath", () => {
    let realpathCalls = 0;
    const fileSystem: FileSystemAdapter = {
      ...nodeFileSystem,
      realpathSync: (filePath) => {
        realpathCalls += 1;
        return filePath;
      },
    };
    const service = new UriIdentityService({ clock, fileSystem });
    const remote = service.createProjectIdentity(
      {
        scheme: "vscode-remote",
        authority: "ssh-remote+example",
        path: "/workspace/app",
      },
      "app",
    );
    const virtual = service.createProjectIdentity(
      { scheme: "memfs", authority: "workspace", path: "/app" },
      "app",
    );

    assert.strictEqual(
      remote.canonicalUri,
      "vscode-remote://ssh-remote+example/workspace/app",
    );
    assert.strictEqual(virtual.canonicalUri, "memfs://workspace/app");
    assert.notStrictEqual(remote.id, virtual.id);
    assert.strictEqual(realpathCalls, 0);
  });

  test("uses document IDs instead of absolute paths in analytical rollups", () => {
    const service = createFallbackService("linux");
    const project = service.createProjectIdentity(
      fileInput("/work/app"),
      "app",
    );
    const document = service.createDocumentIdentity(
      fileInput("/work/app/src/index.ts"),
      project.id,
    );
    const rollup = createEmptyDailyRollup(
      project.id,
      "2026-08-07",
      nowMs,
    );
    rollup.activeTimeByDocumentMs[document.id] = 1000;

    assert.deepStrictEqual(assertDocumentIdentity(document), document);
    assert.deepStrictEqual(assertDailyRollup(rollup), rollup);

    rollup.activeTimeByDocumentMs["/work/app/src/index.ts"] = 1000;
    assert.throws(() => assertDailyRollup(rollup), SchemaValidationError);
  });

  function createFallbackService(
    platform: NodeJS.Platform,
  ): UriIdentityService {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "identity-never-used-"),
    );
    fs.rmSync(tempDirectory, { recursive: true, force: true });
    const fileSystem: FileSystemAdapter = {
      ...nodeFileSystem,
      realpathSync: () => {
        throw new Error("not found");
      },
    };
    return new UriIdentityService({ clock, fileSystem, platform });
  }

  function fileInput(filePath: string) {
    return {
      scheme: "file",
      authority: "",
      path: filePath.replace(/\\/g, "/"),
      fsPath: filePath,
    };
  }
});
