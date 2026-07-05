# Patina Web Sync Privacy Policy

Last updated: June 17, 2026

Patina Web Sync is a browser extension companion for the Patina desktop app. Its purpose is to sync the active webpage to the Patina app running on the same computer, so Patina can include website activity in local time records.

## Data Handled by the Extension

When syncing is enabled and configured, Patina Web Sync may process the following information from the active browser tab:

- Website address
- Page title
- Website icon
- Browser tab ID and window ID
- Browser kind
- Extension version
- Sync timestamp
- Sync event reason
- Incognito status

The extension also stores local configuration in browser extension storage:

- Patina local port
- Patina sync token
- Language preference
- Recent sync status

## How the Data Is Used

Patina Web Sync uses this information only to send the active webpage record to the local Patina desktop app. Patina uses the record to complete local-first time tracking with website context.

## Local Transfer Only

Patina Web Sync sends sync requests only to the local Patina app through local addresses such as `127.0.0.1` or `localhost`, using the configured local port.

The extension does not send synced webpage data to the developer, to Patina cloud services, or to third-party servers.

## What the Extension Does Not Read

Patina Web Sync does not read or collect:

- Page body content
- Page DOM content
- Form values
- Passwords
- Cookies
- Screenshots
- Clipboard contents
- Download history
- Browser history database

## Storage

The extension stores only its configuration and recent sync status in local browser extension storage. Website activity records are stored by the Patina desktop app on the user's computer.

## Sharing and Sale of Data

Patina Web Sync does not sell user data. It does not use synced webpage data for advertising, analytics tracking, profiling, or cross-site tracking. It does not share synced webpage data with third parties.

## User Control

Users can stop syncing by disabling Web Sync in the Patina desktop app, clearing the extension configuration, or uninstalling the extension.

## Permissions

Patina Web Sync requests only the permissions needed for its single purpose:

- `tabs`: read active tab metadata such as website address, title, tab ID, window ID, and icon reference.
- `favicon`: read the browser's local favicon cache so Patina can display the website icon.
- `storage`: store local connection settings, language preference, and recent sync status.
- `alarms`: refresh active tab sync state at lightweight intervals.
- Local host permissions: send sync requests only to the local Patina app on `127.0.0.1` or `localhost`.

## Changes

This policy may be updated when Patina Web Sync changes how it handles data. Updates will be published with the extension source.

## Contact

For privacy questions or support, use the Patina project issue tracker:

https://github.com/Ceceliaee/patina/issues
