import * as assert from "assert";
import {
  isTabNavigationKey,
  nextTabIndex,
} from "../webview/accessibility";

suite("DashboardAccessibility", () => {
  test("wraps arrow navigation and supports Home and End", () => {
    assert.strictEqual(nextTabIndex(0, "ArrowRight", 4), 1);
    assert.strictEqual(nextTabIndex(3, "ArrowRight", 4), 0);
    assert.strictEqual(nextTabIndex(0, "ArrowLeft", 4), 3);
    assert.strictEqual(nextTabIndex(2, "Home", 4), 0);
    assert.strictEqual(nextTabIndex(1, "End", 4), 3);
    assert.strictEqual(nextTabIndex(-1, "ArrowRight", 4), 0);
    assert.strictEqual(nextTabIndex(0, "ArrowRight", 0), 0);
  });

  test("accepts only the ARIA tab navigation keys", () => {
    ["ArrowLeft", "ArrowRight", "Home", "End"].forEach(key =>
      assert.strictEqual(isTabNavigationKey(key), true)
    );
    ["ArrowUp", "ArrowDown", "Enter", " ", "Tab"].forEach(key =>
      assert.strictEqual(isTabNavigationKey(key), false)
    );
  });
});
