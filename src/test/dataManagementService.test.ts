import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  DataManagementFileSystem,
  DataManagementService,
  DataResetError,
  nodeDataManagementFileSystem,
} from "../persistence/DataManagementService";

suite("DataManagementService", () => {
  let temporaryDirectory: string;
  let dataFolderPath: string;
  let idCounter: number;

  setup(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "devtracker-data-management-"),
    );
    dataFolderPath = path.join(temporaryDirectory, "global-storage");
    fs.mkdirSync(dataFolderPath, { recursive: true });
    idCounter = 0;
  });

  teardown(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("exposes the data folder and atomically backs up the complete active tree", async () => {
    const binaryBytes = Buffer.from([0, 255, 1, 254, 2]);
    writeFile("v2/metadata/schema.json", Buffer.from('{"schemaVersion":2}\n'));
    writeFile("v2/sessions/active/session.json", binaryBytes);
    writeFile("compatibility/data.json", Buffer.from("legacy bytes\n"));

    const service = createService();
    assert.strictEqual(service.getDataFolderPath(), dataFolderPath);

    const result = await service.resetConfirmedData();

    assert.strictEqual(result.dataFolderPath, dataFolderPath);
    assert.strictEqual(result.removedEntries, 2);
    assert.match(
      path.basename(result.backupPath),
      /^reset-2026-08-07T12-34-56-789Z-id-1$/,
    );
    assert.deepStrictEqual(
      fs.readFileSync(
        path.join(result.backupPath, "v2/sessions/active/session.json"),
      ),
      binaryBytes,
    );
    assert.strictEqual(
      fs.readFileSync(
        path.join(result.backupPath, "v2/metadata/schema.json"),
        "utf8",
      ),
      '{"schemaVersion":2}\n',
    );
    assert.strictEqual(
      fs.readFileSync(
        path.join(result.backupPath, "compatibility/data.json"),
        "utf8",
      ),
      "legacy bytes\n",
    );
    assert.deepStrictEqual(fs.readdirSync(dataFolderPath), ["reset-backups"]);

    if (process.platform !== "win32") {
      assert.strictEqual(fs.statSync(dataFolderPath).mode & 0o777, 0o700);
      assert.strictEqual(fs.statSync(result.backupPath).mode & 0o777, 0o700);
      assert.strictEqual(
        fs.statSync(
          path.join(result.backupPath, "v2/sessions/active/session.json"),
        ).mode & 0o777,
        0o600,
      );
    }
  });

  test("does not remove any active data when backup creation fails", async () => {
    writeFile("v2/first.json", Buffer.from("first"));
    writeFile("v2/second.json", Buffer.from("second"));
    const failingFileSystem: DataManagementFileSystem = {
      ...nodeDataManagementFileSystem,
      readFile: async (targetPath) => {
        if (targetPath.endsWith(`${path.sep}second.json`)) {
          throw new Error("injected backup read failure");
        }
        return nodeDataManagementFileSystem.readFile(targetPath);
      },
    };
    const service = createService(failingFileSystem);

    await assert.rejects(
      service.resetConfirmedData(),
      (error: unknown) => {
        assert.ok(error instanceof DataResetError);
        assert.strictEqual(error.stage, "backup");
        assert.strictEqual(error.backupPath, null);
        return true;
      },
    );

    assert.strictEqual(readText("v2/first.json"), "first");
    assert.strictEqual(readText("v2/second.json"), "second");
    assert.deepStrictEqual(
      fs.readdirSync(path.join(dataFolderPath, "reset-backups")),
      [],
    );
  });

  test("never follows stored symlinks or accepts an unsafe configured root", async function () {
    assert.throws(
      () =>
        new DataManagementService({
          dataFolderPath: ".",
        }),
      /must be absolute/,
    );
    assert.throws(
      () =>
        new DataManagementService({
          dataFolderPath: path.parse(dataFolderPath).root,
        }),
      /Filesystem root/,
    );

    if (process.platform === "win32") {
      this.skip();
    }

    const outsidePath = path.join(temporaryDirectory, "outside.txt");
    fs.writeFileSync(outsidePath, "must survive");
    fs.symlinkSync(outsidePath, path.join(dataFolderPath, "outside-link"));

    const result = await createService().resetConfirmedData();

    assert.strictEqual(fs.readFileSync(outsidePath, "utf8"), "must survive");
    assert.strictEqual(
      fs.readlinkSync(path.join(result.backupPath, "outside-link")),
      outsidePath,
    );
    assert.ok(!fs.existsSync(path.join(dataFolderPath, "outside-link")));
  });

  test("is repeatable and preserves every earlier backup", async () => {
    writeFile("v2/first.json", Buffer.from("first snapshot"));
    const service = createService();

    const first = await service.resetConfirmedData();
    writeFile("v2/second.json", Buffer.from("second snapshot"));
    const second = await service.resetConfirmedData();
    const third = await service.resetConfirmedData();

    assert.notStrictEqual(first.backupPath, second.backupPath);
    assert.notStrictEqual(second.backupPath, third.backupPath);
    assert.strictEqual(first.removedEntries, 1);
    assert.strictEqual(second.removedEntries, 1);
    assert.strictEqual(third.removedEntries, 0);
    assert.strictEqual(
      fs.readFileSync(path.join(first.backupPath, "v2/first.json"), "utf8"),
      "first snapshot",
    );
    assert.strictEqual(
      fs.readFileSync(path.join(second.backupPath, "v2/second.json"), "utf8"),
      "second snapshot",
    );
    assert.deepStrictEqual(fs.readdirSync(third.backupPath), []);
    assert.deepStrictEqual(
      fs.readdirSync(path.join(dataFolderPath, "reset-backups")).sort(),
      [path.basename(first.backupPath), path.basename(second.backupPath), path.basename(third.backupPath)].sort(),
    );
  });

  test("keeps a complete recovery backup when reset deletion fails", async () => {
    writeFile("v2/recover.json", Buffer.from("recover me"));
    let failRemoval = true;
    const failingFileSystem: DataManagementFileSystem = {
      ...nodeDataManagementFileSystem,
      rm: async (targetPath, options) => {
        if (failRemoval && targetPath === path.join(dataFolderPath, "v2")) {
          throw new Error("injected reset failure");
        }
        return nodeDataManagementFileSystem.rm(targetPath, options);
      },
    };
    const service = createService(failingFileSystem);

    let recoveryBackupPath = "";
    await assert.rejects(
      service.resetConfirmedData(),
      (error: unknown) => {
        assert.ok(error instanceof DataResetError);
        assert.strictEqual(error.stage, "reset");
        assert.ok(error.backupPath);
        recoveryBackupPath = error.backupPath;
        return true;
      },
    );
    assert.strictEqual(
      fs.readFileSync(
        path.join(recoveryBackupPath, "v2/recover.json"),
        "utf8",
      ),
      "recover me",
    );
    assert.strictEqual(readText("v2/recover.json"), "recover me");

    failRemoval = false;
    await service.resetConfirmedData();
    assert.strictEqual(
      fs.readFileSync(
        path.join(recoveryBackupPath, "v2/recover.json"),
        "utf8",
      ),
      "recover me",
    );
  });

  function createService(
    fileSystem: DataManagementFileSystem = nodeDataManagementFileSystem,
  ): DataManagementService {
    return new DataManagementService({
      dataFolderPath,
      fileSystem,
      now: () => new Date("2026-08-07T12:34:56.789Z"),
      createId: () => `id-${++idCounter}`,
    });
  }

  function writeFile(relativePath: string, bytes: Buffer): void {
    const targetPath = path.join(dataFolderPath, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, bytes);
  }

  function readText(relativePath: string): string {
    return fs.readFileSync(path.join(dataFolderPath, relativePath), "utf8");
  }
});
