# Codex color reference fixtures

`codex-colors.json` contains independent expected outputs for the mapped theme colors. The fixture covers Catppuccin, Vercel and Xcode in both modes at zero, 100, preset defaults and around the contrast shaping breakpoint. The Catppuccin light case at 40 preserves the supplied user example; its preset default is 45.

Reference: Windows Codex package `26.901.6511.0`, internal app version `26.901.51231`, inspected on 2026-09-09. The installed archive was read without modification. SHA-256:

- `app.asar`: `e75bae2b8a02f174c7ceeed6d631aaff355e44f8af5c798fa3628089f11d659e`.
- `webview/assets/app-initial-f87238153a19.js`: `44ceeb9cadac569f6217e288c0e09fceeca712d749862887ea36baf6019ea966`.

The reference outputs were evaluated outside the repository using the original pure functions: `q_a` resolves theme colors, `J_a` merges `chromeTheme`, `mY` normalizes inputs, `l_a` shapes contrast, `m_a`/`g_a` derive light/dark colors and `p_a` maps CSS names. RGB mixing uses `vY`/`x_a`; alpha formatting uses `S_a`. Fixtures do not call Patina's implementation. The original bundle, extraction scratch files, fonts and screenshots are not test dependencies and are not stored here.

All available Patina preset/mode pairs were checked against that loader. Vercel explicitly sets light 40 and dark 50; the remaining matching presets inherit light 45 or dark 60. Xcode's `chromeTheme` supplies opaque ink, overriding the translucent editor foreground. Ayu's effective background is `#10141c`. [themePresets.ts](../../../src/shared/theme/themePresets.ts) owns the resulting palette data. Patina's `default` retains its own surface, ink and accent with the mode defaults and is not presented as a Codex preset.

The remaining direct comparisons cover surface-under, surface and panel. Named themes retain these background derivations; nested cards use a Patina mapping. Default uses the complete original Patina palette.

Text hierarchy, slider tracks, switches, muted accents, disabled states, scrollbars and chart helpers retain Patina's prior mixing rules. Corrected preset seeds feed those rules without adopting Codex control contrast. Primary button text stays white.

When updating the reference, bind the new version and hashes first, independently recalculate expected outputs from its loader/functions, review mapping changes, then run `npm run test:settings`. Do not regenerate expected colors by calling the function being tested.

Named themes' nested cards use Patina's surface mapping: light blends surface-under 30% toward panel; dark blends surface 25% toward panel. This keeps nested rows darker than their panel in both modes, with a softer light fill. The mapping is covered separately from Codex equivalence.

`patina-borders.json` records the final CSS cascade from Patina commit `a9e4e2cc8b1f9375c70ee1e5e22327fa2d972e7c`, resolving variable references while preserving native color-mix expressions and alpha. Ordinary and strong borders retain these colors independently of Codex derivation. Primary button text stays white. These application-specific mappings are excluded from the Codex fixture comparison and covered by Patina regression assertions.

`patina-controls.json` independently records the prior final CSS cascade for Default, Absolutely, Catppuccin and Vercel in both modes. The test checks each retained control color; browser tests additionally compare the rendered settings slider gradient, borders, hover geometry and white primary text. These fixtures are captured from the same Patina commit as the border fixture, never from the implementation under test.
