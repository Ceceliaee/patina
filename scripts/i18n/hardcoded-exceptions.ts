export interface HardcodedCopyException {
  readonly file: string;
  readonly value: string;
  readonly owner: string;
  readonly reason: string;
}

// Exact reviewed exceptions only; globs and regular expressions are unsupported.
export const HARDCODED_COPY_EXCEPTIONS: readonly HardcodedCopyException[] = [
  { file: "src/app/components/AppTitleBar.tsx", value: "Patina", owner: "product-brand", reason: "Registered product name; it must remain untranslated." },
  { file: "src/features/about/components/AboutPanel.tsx", value: "Patina", owner: "product-brand", reason: "Registered product name; it must remain untranslated." },
  { file: "src/features/about/components/AboutPanel.tsx", value: "GitHub", owner: "external-brand", reason: "Registered service name; it must remain untranslated." },
  { file: "src/features/about/components/AboutPanel.tsx", value: "Star", owner: "github-action", reason: "GitHub's canonical action label is intentionally preserved." },
  { file: "src/shared/components/QuietColorField.tsx", value: "HEX", owner: "color-format", reason: "Standard color-model identifier, not natural-language copy." },
  { file: "src/shared/components/QuietColorField.tsx", value: "RGB", owner: "color-format", reason: "Standard color-model identifier, not natural-language copy." },
  { file: "src/shared/components/QuietColorField.tsx", value: "HSL", owner: "color-format", reason: "Standard color-model identifier, not natural-language copy." },
  { file: "src/platform/persistence/commandError.ts", value: "The operation could not be completed.", owner: "platform-diagnostics", reason: "Diagnostic fallback carried across the platform boundary; user surfaces map operation outcomes to localized copy." },
];
