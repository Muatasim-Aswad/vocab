/** Focus that left with a removed element, or never left the page body, may move; other focus stays. */
export const focusWasLost = () =>
  !document.activeElement ||
  document.activeElement === document.body ||
  !document.activeElement.isConnected;
