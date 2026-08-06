// en-US update locale resource. Pure data only.
export const MESSAGES = {
  "update.appUpdate": "App updates",
  "update.checkAgain": "Check again",
  "update.checkErrorDetail": "Could not access the update manifest. Your current network may not be able to reach GitHub. Try again later or download manually.",
  "update.checkFailed": "Could not check updates",
  "update.checkFailedDialog": "Could not check updates",
  "update.checking": "Checking...",
  "update.checkingUpdates": "Checking for updates...",
  "update.checkUpdates": "Check updates",
  "update.dialogAvailable": "New version available",
  "update.dialogAvailableDetail": "A new version is available. Download first, then confirm installation.",
  "update.dialogDownloaded": "Update downloaded",
  "update.dialogDownloadedDetail": "The update package is ready. Confirm to restart and finish installation.",
  "update.dialogDownloading": "Downloading update",
  "update.dialogDownloadingDetail": "The update package is downloading. Installation confirmation appears when it finishes.",
  "update.dialogInstalling": "Installing update",
  "update.dialogInstallingDetail": "Installation has started. Keep the app open; it will restart when finished.",
  "update.downloadedBytes": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Downloaded ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "update.downloadedDetail": "The update package is downloaded. Confirm to restart and install.",
  "update.downloadedTitle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Update downloaded: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.downloadErrorDetail": "A new version was found, but automatic download failed. You can download manually.",
  "update.downloadFailed": "Could not download installer",
  "update.downloadFailedDialog": "Download failed",
  "update.downloading": "Downloading update...",
  "update.downloadInstaller": "Download installer",
  "update.downloadNow": "Download now",
  "update.errorDetailWithSummary": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "prefix"
        },
        " Details: ",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "update.feedback": "Feedback",
  "update.foundVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "New version: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.genericErrorDetail": "The update flow could not finish. Try again later.",
  "update.installAgain": "Install again",
  "update.installErrorDetail": "The update package was downloaded, but installation did not finish. Try installing again or redownload it.",
  "update.installFailed": "Update installation failed",
  "update.installFailedDialog": "Install failed",
  "update.installing": "Installing update...",
  "update.installingProgress": "Installing update. The app will restart soon.",
  "update.installRestartDetail": "The app will restart after installation.",
  "update.later": "Later",
  "update.manualDownload": "Manual download",
  "update.notChecked": "Not checked",
  "update.packageDownloaded": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "notEq",
        "left": { "$op": "coalesce", "left": { "$op": "arg", "name": "value" }, "right": "" },
        "right": ""
      },
      "then": {
        "$op": "concat",
        "parts": [
          "Package ",
          {
            "$op": "arg",
            "name": "value"
          },
          " downloaded"
        ]
      },
      "else": "Package downloaded"
    }
  },
  "update.preparingPackage": "Preparing the update package.",
  "update.processing": "Processing...",
  "update.progressPending": "Getting progress",
  "update.redownloadInstaller": "Download again",
  "update.releaseNotes": "Release notes",
  "update.restartInstall": "Restart to install",
  "update.sidebarEntry": "Update",
  "update.support": "Sponsor",
  "update.targetVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "New version: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.unknownVersion": "unknown version",
  "update.updateFailed": "Update failed",
  "update.updateFailedDialog": "Update failed",
  "update.updateProcessFailed": "The update flow could not finish.",
  "update.updateReadyDetail": "A new version is available. Confirm to start downloading.",
  "update.upToDate": "You are up to date"
} as const;
