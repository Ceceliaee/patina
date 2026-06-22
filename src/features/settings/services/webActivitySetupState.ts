type WebActivitySetupSnapshot = {
  enabled: boolean;
  connected: boolean;
} | null;

export interface WebActivitySetupInput {
  draftEnabled: boolean;
  draftPort: number;
  draftToken: string;
  savedEnabled: boolean;
  savedPort: number;
  savedToken: string;
  snapshot: WebActivitySetupSnapshot;
}

export function shouldShowWebActivityHelp(input: WebActivitySetupInput): boolean {
  if (!input.draftEnabled) {
    return false;
  }

  const draftToken = input.draftToken.trim();
  const savedToken = input.savedToken.trim();
  if (draftToken.length === 0) {
    return true;
  }

  if (!input.savedEnabled || input.draftPort !== input.savedPort || draftToken !== savedToken) {
    return true;
  }

  return !(input.snapshot?.enabled && input.snapshot.connected);
}
