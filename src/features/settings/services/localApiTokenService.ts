const LOCAL_API_TOKEN_BYTES = 24;

type FillRandomValues = (bytes: Uint8Array) => Uint8Array;

function fillSecureRandomValues(bytes: Uint8Array) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("secure random values are unavailable");
  }
  return globalThis.crypto.getRandomValues(bytes);
}

export function createLocalApiToken(fillRandomValues: FillRandomValues = fillSecureRandomValues) {
  const bytes = new Uint8Array(LOCAL_API_TOKEN_BYTES);
  fillRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildLocalApiEnabledChange(
  nextChecked: boolean,
  currentToken: string,
  createToken: () => string = createLocalApiToken,
) {
  if (!nextChecked) {
    return {
      enabled: false,
      token: null,
    };
  }

  const token = currentToken.trim() || createToken();
  return {
    enabled: token.length > 0,
    token,
  };
}
