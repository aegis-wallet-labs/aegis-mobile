import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const PIN_HASH_KEY = 'aegis.pin.hash.v1';
const PIN_SALT_KEY = 'aegis.pin.salt.v1';
const BIOMETRICS_KEY = 'aegis.biometrics.enabled.v1';
const FAILED_ATTEMPTS_KEY = 'aegis.pin.failed.v1';
const LOCKOUT_UNTIL_KEY = 'aegis.pin.lockout.v1';
const MAX_ATTEMPTS = 5;

function randomSalt() {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin, salt) {
  let value = `aegis-pin-v1:${salt}:${pin}`;
  for (let i = 0; i < 1200; i += 1) {
    value = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${value}:${i}`);
  }
  return value;
}

async function getNumber(key) {
  const value = await SecureStore.getItemAsync(key);
  return value ? Number(value) : 0;
}

async function setNumber(key, value) {
  await SecureStore.setItemAsync(key, String(value));
}

export async function getAuthState() {
  const [hash, biometricFlag] = await Promise.all([
    SecureStore.getItemAsync(PIN_HASH_KEY),
    SecureStore.getItemAsync(BIOMETRICS_KEY),
  ]);
  const compatible = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return {
    hasPin: Boolean(hash),
    biometricsEnabled: biometricFlag === 'true',
    biometricsAvailable: compatible && enrolled,
  };
}

export async function setPin(pin) {
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN must be 6 digits.');
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  await SecureStore.setItemAsync(PIN_SALT_KEY, salt);
  await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
  await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
  await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
}

export async function verifyPin(pin) {
  const lockoutUntil = await getNumber(LOCKOUT_UNTIL_KEY);
  if (lockoutUntil && Date.now() < lockoutUntil) {
    return { ok: false, lockedUntil: lockoutUntil };
  }

  const [salt, storedHash] = await Promise.all([
    SecureStore.getItemAsync(PIN_SALT_KEY),
    SecureStore.getItemAsync(PIN_HASH_KEY),
  ]);
  if (!salt || !storedHash) return { ok: false };

  const nextHash = await hashPin(pin, salt);
  if (nextHash === storedHash) {
    await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
    await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
    return { ok: true };
  }

  const attempts = (await getNumber(FAILED_ATTEMPTS_KEY)) + 1;
  await setNumber(FAILED_ATTEMPTS_KEY, attempts);
  if (attempts >= MAX_ATTEMPTS) {
    const extraAttempts = Math.max(0, attempts - MAX_ATTEMPTS);
    const lockMs = Math.min(30 * 60 * 1000, 30 * 1000 * (2 ** extraAttempts));
    const until = Date.now() + lockMs;
    await setNumber(LOCKOUT_UNTIL_KEY, until);
    return { ok: false, lockedUntil: until };
  }
  return { ok: false };
}

export async function authenticateBiometrics() {
  // disableDeviceFallback keeps the OS credential screen out of the flow —
  // the app's own PIN pad is the fallback. authenticateAsync rejects if the
  // activity is mid-transition ("current activity is no longer available"),
  // so treat any throw as a failed attempt instead of crashing.
  try {
    const state = await getAuthState();
    if (!state.biometricsAvailable) return false;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Aegis AI Wallet',
      cancelLabel: 'Use passcode',
      disableDeviceFallback: true,
    });
    return Boolean(result.success);
  } catch {
    return false;
  }
}

export async function setBiometricsEnabled(enabled) {
  if (enabled) {
    const ok = await authenticateBiometrics();
    if (!ok) return false;
  }
  await SecureStore.setItemAsync(BIOMETRICS_KEY, enabled ? 'true' : 'false');
  return true;
}

export async function clearAuth() {
  await Promise.all([
    SecureStore.deleteItemAsync(PIN_HASH_KEY),
    SecureStore.deleteItemAsync(PIN_SALT_KEY),
    SecureStore.deleteItemAsync(BIOMETRICS_KEY),
    SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY),
    SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY),
  ]);
}

export function tapHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}