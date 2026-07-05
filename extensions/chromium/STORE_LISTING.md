# Patina Web Sync Chrome Web Store Listing Draft

This file collects the copy and review notes needed for a Chrome Web Store submission.

## Product Details

Name:

Patina Web Sync

Short description:

Sync the active webpage to the Patina desktop app for local-first time tracking.

Category:

Productivity

Languages:

Default: Simplified Chinese

Internationalization: English

Mature content:

No

## Detailed Description

Patina Web Sync is the browser companion for Patina, a local-first desktop time tracking app.

The extension syncs the active webpage to the Patina desktop app running on your computer. This helps Patina complete desktop time records with website context, while keeping your activity local.

Patina Web Sync sends only the active webpage's website address, page title, and website icon to your local Patina app. It connects only to local addresses such as `127.0.0.1` or `localhost`.

It does not read page content, form values, passwords, screenshots, clipboard contents, cookies, download history, or the browser history database.

Patina Web Sync requires the Patina desktop app to be installed and Web Sync to be enabled in Patina settings.

Key features:

- Sync the active webpage to local Patina.
- Keep website activity records on your own computer.
- Use a local port and token for pairing with Patina.
- Show whether the current page has synced.
- Support regular website pages using `http` and `https`.

## Privacy Practices

Single purpose:

Sync metadata for the active browser tab to the local Patina desktop app so Patina can include website activity in local time records.

Remote code:

No remote code is used.

Data disclosure:

Disclose web browsing activity because the extension handles the active webpage's website address, title, and website icon. The extension does not read page body content, form values, passwords, screenshots, clipboard contents, cookies, download history, or the browser history database.

Privacy policy URL:

Use the public repository URL after this file is pushed:

https://github.com/Ceceliaee/patina/blob/main/extensions/chromium/PRIVACY.md

## Permission Justifications

`tabs`:

Used to read the active tab's website address, title, icon reference, tab ID, and window ID so the active webpage can be synced to local Patina.

`favicon`:

Used to read the browser's local favicon cache so Patina can display the website icon.

`storage`:

Used to store local connection settings, language preference, and recent sync status in browser extension storage.

`alarms`:

Used to refresh the active tab sync state at lightweight intervals.

Host permissions for `http://127.0.0.1/*` and `http://localhost/*`:

Used only to send sync requests to the Patina desktop app running on the user's own computer.

## Store Links

Homepage URL:

https://github.com/Ceceliaee/patina

Support URL:

https://github.com/Ceceliaee/patina/issues

## Graphic Assets Checklist

Required:

- Store icon: 128x128 PNG
- At least one screenshot: 1280x800 PNG or JPEG
- Small promo tile: 440x280 PNG or JPEG

Optional:

- Marquee promo tile: 1400x560 PNG or JPEG
- YouTube feature video

Suggested screenshots:

- Popup showing a synced regular webpage.
- Options page showing port, token, and sync content.
- Patina desktop history page showing website activity after sync.

## Reviewer Test Instructions

1. Install and open the Patina desktop app.
2. In Patina Settings, enable Web Sync.
3. Copy the Web Sync port and token from Patina into the extension options page.
4. Open a regular `http` or `https` webpage.
5. Open the extension popup and choose Sync current page.
6. Confirm that the popup shows the synced state.
7. Confirm that Patina records the current website activity locally.

Expected behavior:

- Regular `http` and `https` pages can be synced.
- Browser internal pages such as `chrome://extensions` are shown as not synced.
- No page body content, forms, screenshots, clipboard data, cookies, download history, or browser history database are read.
