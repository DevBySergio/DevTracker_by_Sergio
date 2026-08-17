export type TabNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

export function nextTabIndex(
  currentIndex: number,
  key: TabNavigationKey,
  tabCount: number,
): number {
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || tabCount <= 0) {
    return 0;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return tabCount - 1;
  }
  const direction = key === "ArrowRight" ? 1 : -1;
  return (currentIndex + direction + tabCount) % tabCount;
}

export function isTabNavigationKey(
  key: string,
): key is TabNavigationKey {
  return key === "ArrowLeft" || key === "ArrowRight" ||
    key === "Home" || key === "End";
}
