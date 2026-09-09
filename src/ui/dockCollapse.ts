export function nextDockMin(
  prevMin: boolean,
  scrollY: number,
  lastScrollY: number,
  focusedInDock: boolean
): boolean {
  if (focusedInDock) return prevMin;
  if (scrollY < lastScrollY) return false;
  if (scrollY > lastScrollY + 8 && scrollY > 80) return true;
  return prevMin;
}