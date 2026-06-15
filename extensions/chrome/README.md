# Patina Web Activity Bridge

Chrome/Chromium MV3 extension for Patina web activity recording.

## Local Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this `extensions/chrome` directory.
5. In Patina Settings, enable `网页记录` and copy the port/token into the extension options page.

## Scope

- Sends only active tab URL, title, favicon, incognito flag, tab/window id, browser kind, and timestamps to local Patina.
- Uses one local HTTP POST when the active tab changes; Patina handles timing from its foreground app tracker.
- Uses Chrome's local favicon cache to turn active-tab icons into local data for icon colors.
- Does not read page DOM, form values, screenshots, clipboard, history database, or page content.
- Stores extension configuration in Chrome local extension storage.
