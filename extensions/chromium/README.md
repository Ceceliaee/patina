# Patina Web Sync

Chromium MV3 extension companion for Patina.

This file documents the extension project itself. User-facing setup instructions live in Patina Settings.

Simplified Chinese project README: [`README.zh-CN.md`](./README.zh-CN.md).

## Purpose

Patina Web Sync sends the active webpage from a Chromium-based browser to the local Patina desktop app, so Patina can include website activity in local-first time records.

## Current Distribution

Patina Web Sync is currently distributed through GitHub Releases and manual local installation.

Chrome Web Store listing materials are kept in this repository for a future store submission, but the extension is not published on the Chrome Web Store yet.

## Source Layout

- `manifest.json`: Chromium MV3 extension manifest.
- `background.js`: service worker for active-tab sync and local Patina requests.
- `popup.html` / `popup.js`: browser action popup.
- `options.html` / `options.js`: extension options page.
- `icons/`: extension icons.
- `PRIVACY.md`: Chrome Web Store privacy policy draft.
- `STORE_LISTING.md`: Chrome Web Store listing draft.

## Maintainer Workflow

Check the extension source:

```bash
npm run extension:chromium:check
```

Build the unpacked extension:

```bash
npm run extension:chromium:build
```

Build the release zip:

```bash
npm run extension:chromium:package
```

The uploadable zip is generated at:

```text
dist/extensions/chromium/patina-chromium-extension-v0.1.0.zip
```

The version in the file name comes from `manifest.json`.
The zip contains a versioned extension folder. Users load that extracted folder in the browser extension page and follow the Web Sync instructions in Patina Settings.

## Scope

- Sends only active tab URL, title, favicon, incognito flag, tab/window id, browser kind, and timestamps to local Patina.
- Uses one local HTTP POST when the active tab changes; Patina handles timing from its foreground app tracker.
- Uses the browser's local favicon cache to turn active-tab icons into local data for icon colors.
- Does not read page DOM, form values, screenshots, clipboard, history database, or page content.
- Stores extension configuration in the browser's local extension storage.

## Chrome Web Store Draft

- Privacy policy: [`PRIVACY.md`](./PRIVACY.md)
- Store listing draft: [`STORE_LISTING.md`](./STORE_LISTING.md)
