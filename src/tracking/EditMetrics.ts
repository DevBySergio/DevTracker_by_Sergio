import { EditorEditActivity } from "../domain/types";

export const LARGE_EDIT_CHARACTER_THRESHOLD = 80;
export const LARGE_EDIT_LINE_BREAK_THRESHOLD = 4;

export interface TextChangeMetricInput {
  text: string;
  rangeLength: number;
  removedLineSpan: number;
}

/**
 * Summarizes one VS Code document-change callback. The event, rather than each
 * individual content change, is the unit used by `editEvents` and
 * `largeEditEvents`.
 */
export function summarizeEditorEdit(
  changes: readonly TextChangeMetricInput[],
): EditorEditActivity {
  let insertedCharacters = 0;
  let removedCharacters = 0;
  let insertedLineBreaksApprox = 0;
  let removedLineBreaksApprox = 0;

  for (const change of changes) {
    insertedCharacters += change.text.length;
    removedCharacters += change.rangeLength;
    insertedLineBreaksApprox += countLineBreaks(change.text);
    removedLineBreaksApprox += change.removedLineSpan;
  }

  return {
    insertedCharacters,
    removedCharacters,
    largeEditEvents:
      insertedCharacters >= LARGE_EDIT_CHARACTER_THRESHOLD ||
      insertedLineBreaksApprox >= LARGE_EDIT_LINE_BREAK_THRESHOLD
        ? 1
        : 0,
    insertedLineBreaksApprox,
    removedLineBreaksApprox,
  };
}

function countLineBreaks(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  return count;
}
