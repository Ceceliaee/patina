const SETTINGS_TOKEN_BYTES = 24;

type FillRandomValues = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

function fillSecureRandomValues(bytes: Uint8Array<ArrayBuffer>) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("secure random values are unavailable");
  }
  return globalThis.crypto.getRandomValues(bytes);
}

export function createSettingsToken(fillRandomValues: FillRandomValues = fillSecureRandomValues) {
  const bytes = new Uint8Array(SETTINGS_TOKEN_BYTES);
  fillRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
