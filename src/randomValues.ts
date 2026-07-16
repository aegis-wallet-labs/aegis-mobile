import * as Crypto from 'expo-crypto';

const root = globalThis as any;

if (!root.crypto) {
  root.crypto = {};
}

if (!root.crypto.getRandomValues) {
  root.crypto.getRandomValues = (typedArray: any) => Crypto.getRandomValues(typedArray);
}

if (!root.crypto.randomUUID && Crypto.randomUUID) {
  root.crypto.randomUUID = () => Crypto.randomUUID();
}
