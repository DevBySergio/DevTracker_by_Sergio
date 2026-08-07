import * as assert from "assert";
import { summarizeEditorEdit } from "../tracking/EditMetrics";

suite("Editor edit metrics", () => {
  test("counts insertion and deletion independently", () => {
    assert.deepStrictEqual(
      summarizeEditorEdit([
        { text: "abc", rangeLength: 0, removedLineSpan: 0 },
      ]),
      {
        insertedCharacters: 3,
        removedCharacters: 0,
        largeEditEvents: 0,
        insertedLineBreaksApprox: 0,
        removedLineBreaksApprox: 0,
      },
    );

    assert.deepStrictEqual(
      summarizeEditorEdit([
        { text: "", rangeLength: 5, removedLineSpan: 2 },
      ]),
      {
        insertedCharacters: 0,
        removedCharacters: 5,
        largeEditEvents: 0,
        insertedLineBreaksApprox: 0,
        removedLineBreaksApprox: 2,
      },
    );
  });

  test("counts replacements in both character directions", () => {
    assert.deepStrictEqual(
      summarizeEditorEdit([
        { text: "abc", rangeLength: 2, removedLineSpan: 0 },
      ]),
      {
        insertedCharacters: 3,
        removedCharacters: 2,
        largeEditEvents: 0,
        insertedLineBreaksApprox: 0,
        removedLineBreaksApprox: 0,
      },
    );
  });

  test("aggregates a multi-change callback as one edit payload", () => {
    assert.deepStrictEqual(
      summarizeEditorEdit([
        { text: "a".repeat(40), rangeLength: 3, removedLineSpan: 1 },
        { text: "b".repeat(40), rangeLength: 4, removedLineSpan: 2 },
      ]),
      {
        insertedCharacters: 80,
        removedCharacters: 7,
        largeEditEvents: 1,
        insertedLineBreaksApprox: 0,
        removedLineBreaksApprox: 3,
      },
    );
  });

  test("labels line activity as an approximation and applies exact thresholds", () => {
    const belowThreshold = summarizeEditorEdit([
      { text: `${"x".repeat(75)}\n\n\n`, rangeLength: 0, removedLineSpan: 0 },
    ]);
    assert.strictEqual(belowThreshold.insertedCharacters, 78);
    assert.strictEqual(belowThreshold.insertedLineBreaksApprox, 3);
    assert.strictEqual(belowThreshold.largeEditEvents, 0);

    const fourLineBreaks = summarizeEditorEdit([
      { text: "a\nb\nc\nd\ne", rangeLength: 6, removedLineSpan: 4 },
    ]);
    assert.strictEqual(fourLineBreaks.insertedLineBreaksApprox, 4);
    assert.strictEqual(fourLineBreaks.removedLineBreaksApprox, 4);
    assert.strictEqual(fourLineBreaks.largeEditEvents, 1);
  });
});
