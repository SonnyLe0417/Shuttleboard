let enabled = true;

export const haptics = {
  setEnabled(on: boolean) {
    enabled = on;
  },
  tap() {
    if (!enabled || typeof navigator === "undefined" || !navigator.vibrate) return;
    navigator.vibrate(15);
  },
  bump() {
    if (!enabled || typeof navigator === "undefined" || !navigator.vibrate) return;
    navigator.vibrate([20, 30, 20]);
  },
  win() {
    if (!enabled || typeof navigator === "undefined" || !navigator.vibrate) return;
    navigator.vibrate([40, 60, 40, 60, 120]);
  },
};
