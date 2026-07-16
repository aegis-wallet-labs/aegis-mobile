/**
 * Temporary auto-lock suppression.
 *
 * Some intentional in-app actions briefly send the app to the background/inactive
 * (e.g. the OS camera-permission dialog). Those must NOT trigger the lock screen
 * — the user never actually left. Screens call `suppressAutoLock()` right before
 * such an action; the AppState lock handler checks `isAutoLockSuppressed()`.
 */
let suppressUntil = 0;

export function suppressAutoLock(ms = 10000) {
  suppressUntil = Date.now() + ms;
}

export function isAutoLockSuppressed() {
  return Date.now() < suppressUntil;
}
