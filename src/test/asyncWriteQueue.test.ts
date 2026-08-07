import * as assert from "assert";
import { AsyncWriteQueue } from "../persistence/AsyncWriteQueue";

suite("AsyncWriteQueue", () => {
  let nowMs: number;

  setup(() => {
    nowMs = Date.UTC(2026, 7, 7, 12, 0, 0);
  });

  test("coalesces repeated record writes and reports a healthy flush", async () => {
    const queue = createQueue();
    const writes: number[] = [];

    queue.enqueue("session-alpha", async () => {
      writes.push(1);
    });
    queue.enqueue("session-alpha", async () => {
      writes.push(2);
    });

    assert.deepStrictEqual(queue.getHealth(), {
      status: "pending",
      pendingWrites: 1,
      lastSuccessfulWriteAt: null,
      lastError: null,
    });

    nowMs += 1000;
    await queue.flush();

    assert.deepStrictEqual(writes, [2]);
    assert.deepStrictEqual(queue.getHealth(), {
      status: "idle",
      pendingWrites: 0,
      lastSuccessfulWriteAt: nowMs,
      lastError: null,
    });
  });

  test("serializes writes for independent records", async () => {
    const queue = createQueue();
    let concurrentWrites = 0;
    let maximumConcurrentWrites = 0;
    const completed: string[] = [];

    const write = (key: string) => async () => {
      concurrentWrites += 1;
      maximumConcurrentWrites = Math.max(
        maximumConcurrentWrites,
        concurrentWrites,
      );
      await Promise.resolve();
      completed.push(key);
      concurrentWrites -= 1;
    };

    queue.enqueue("metadata", write("metadata"));
    queue.enqueue("session-alpha", write("session-alpha"));
    await queue.flush();

    assert.strictEqual(maximumConcurrentWrites, 1);
    assert.deepStrictEqual(completed, ["metadata", "session-alpha"]);
  });

  test("retains failed work and succeeds on a later forced flush", async () => {
    const queue = createQueue();
    let attempts = 0;

    queue.enqueue("rollup-alpha", async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("disk unavailable");
      }
    });

    await assert.rejects(queue.flush(), /disk unavailable/);
    assert.deepStrictEqual(queue.getHealth(), {
      status: "failed",
      pendingWrites: 1,
      lastSuccessfulWriteAt: null,
      lastError: "disk unavailable",
    });

    nowMs += 1000;
    await queue.flush();

    assert.strictEqual(attempts, 2);
    assert.strictEqual(queue.getHealth().status, "idle");
    assert.strictEqual(queue.getHealth().pendingWrites, 0);
  });

  function createQueue(): AsyncWriteQueue {
    return new AsyncWriteQueue({
      clock: {
        now: () => new Date(nowMs),
        nowMs: () => nowMs,
      },
      debounceMs: 60_000,
      onBackgroundError: () => undefined,
    });
  }
});
