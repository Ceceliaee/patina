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
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Absolutely", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Ayu", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Catppuccin", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Dracula", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Everforest", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "GitHub", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Gruvbox", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Linear", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Lobster", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Material", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Matrix", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Monokai", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Night Owl", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Nord", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Notion", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "One", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Oscurange", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Proof", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Raycast", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Rose Pine", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Sentry", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Solarized", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Temple", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Tokyo Night", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Vercel", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "VS Code Plus", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
  { file: "src/shared/settings/colorSchemeOptions.ts", value: "Xcode", owner: "theme-registry", reason: "Registered theme name shown verbatim." },
];
