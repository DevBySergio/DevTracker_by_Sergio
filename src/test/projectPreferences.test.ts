import * as assert from "assert";
import {
  ProjectPreferenceStorage,
  ProjectPreferencesStore,
  parseSetProjectPreferenceMessage,
} from "../presentation/ProjectPreferences";

suite("ProjectPreferences", () => {
  test("validates exact preference messages and persists normalized local state", async () => {
    const storage = new MemoryStorage();
    const store = new ProjectPreferencesStore(storage);
    const message = parseSetProjectPreferenceMessage({
      type: "dashboard/set-project-preference",
      protocolVersion: 1,
      projectId: "project-alpha",
      preference: { alias: "  Client Portal  ", archived: true, excluded: false },
    }, 1);

    assert.ok(message);
    const saved = await store.set(message.projectId, message.preference);
    assert.deepStrictEqual(saved, {
      "project-alpha": {
        alias: "Client Portal",
        archived: true,
        excluded: false,
      },
    });
    assert.deepStrictEqual(store.getAll(), saved);
  });

  test("rejects arbitrary fields, unsafe ids, and oversized aliases", () => {
    const base = {
      type: "dashboard/set-project-preference",
      protocolVersion: 1,
      projectId: "project-alpha",
      preference: { alias: null, archived: false, excluded: true },
    };
    assert.strictEqual(
      parseSetProjectPreferenceMessage({ ...base, command: "delete" }, 1),
      null,
    );
    assert.strictEqual(
      parseSetProjectPreferenceMessage({ ...base, projectId: "../private" }, 1),
      null,
    );
    assert.strictEqual(
      parseSetProjectPreferenceMessage({
        ...base,
        preference: { ...base.preference, alias: "x".repeat(81) },
      }, 1),
      null,
    );
  });
});

class MemoryStorage implements ProjectPreferenceStorage {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string, defaultValue: T): T {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T;
  }

  public update(key: string, value: unknown): Thenable<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}
