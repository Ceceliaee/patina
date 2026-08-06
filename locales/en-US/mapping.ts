// en-US mapping locale resource. Pure data only.
export const MESSAGES = {
  "mapping.appSearchPlaceholder": "Search apps or categories",
  "mapping.cancel": "Cancel",
  "mapping.categoryControl": "Manage categories",
  "mapping.categoryDialogDescription": "Create categories and adjust category colors",
  "mapping.categoryDialogTitle": "Manage categories",
  "mapping.categorySelectLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Category for ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.color": "Color",
  "mapping.createCategoryAction": "New category",
  "mapping.createCategoryDescription": "Recommended: 2 CJK characters or 1 English word.",
  "mapping.createCategoryPlaceholder": "Example: Study",
  "mapping.createCategoryTitle": "New category",
  "mapping.deleteAppRecords": "Delete records",
  "mapping.deleteAppSessionsDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "All app records for ",
        {
          "$op": "arg",
          "name": "label"
        },
        ", including Patina and imported records, will be deleted. Other apps and imported records are unaffected."
      ]
    }
  },
  "mapping.deleteAppSessionsTitle": "Delete app records",
  "mapping.deleteCategory": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Delete category: ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.deleteCategoryDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "This will delete the ",
        {
          "$op": "arg",
          "name": "label"
        },
        " category."
      ]
    }
  },
  "mapping.deleteCategoryTitle": "Delete category",
  "mapping.deleteWebDomainHistoryDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "This will delete web records for ",
        {
          "$op": "arg",
          "name": "label"
        },
        "."
      ]
    }
  },
  "mapping.deleteWebDomainHistoryTitle": "Delete web records",
  "mapping.deleteWebRecords": "Delete web records",
  "mapping.disableTitleCapture": "Stop recording titles",
  "mapping.disableTracking": "Stop tracking and hide existing history",
  "mapping.disableWebTracking": "Stop tracking and hide existing history",
  "mapping.editAppName": "Edit app name",
  "mapping.editWebDomainName": "Edit website name",
  "mapping.emptyState": "No apps match the current filter",
  "mapping.enableTitleCapture": "Resume recording titles",
  "mapping.enableTracking": "Resume tracking and restore existing history",
  "mapping.enableWebTracking": "Resume tracking and restore existing history",
  "mapping.excludeStats": "Exclude stats",
  "mapping.filters.all": "All",
  "mapping.filters.classified": "Classified",
  "mapping.filters.other": "Unclassified",
  "mapping.globalTitleDisabled": "Global titles are off",
  "mapping.idle": "Saved",
  "mapping.loadFailed": "Classification data failed to load.",
  "mapping.loading": "Loading...",
  "mapping.noStats": "Excluded",
  "mapping.objectModeApp": "Apps",
  "mapping.objectModeWeb": "Web",
  "mapping.quickCategoryMenuLabel": "Available categories",
  "mapping.quickChangeCategory": "Change category",
  "mapping.quickMenuLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Quick actions for ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.quickRename": "Change name",
  "mapping.quickRenamePlaceholder": "App name",
  "mapping.quickRenameTitle": "Change app name",
  "mapping.quickRestoreDefaultName": "Restore default name",
  "mapping.quickSave": "Save",
  "mapping.quickSaveFailed": "Could not save. Existing settings were not changed.",
  "mapping.quickSaving": "Saving…",
  "mapping.quickSetCategory": "Set category",
  "mapping.quickUnclassified": "Unclassified",
  "mapping.renameCategory": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Rename category: ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.renameCategoryDescription": "Apps and websites using this category will show the new name.",
  "mapping.renameCategoryDuplicateDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "label"
        },
        " already exists. Continuing will merge this category into it."
      ]
    }
  },
  "mapping.renameCategoryDuplicateTitle": "Merge matching category",
  "mapping.renameCategoryPlaceholder": "New category name",
  "mapping.renameCategoryTitle": "Rename category",
  "mapping.restoreDefaultColor": "Restore default color",
  "mapping.restoreStats": "Restore stats",
  "mapping.retry": "Retry",
  "mapping.save": "Save",
  "mapping.saving": "Saving...",
  "mapping.searchNoResults": "No matching apps found",
  "mapping.statsEnabled": "Included",
  "mapping.subtitle": "Manage app and web rules",
  "mapping.title": "Classification",
  "mapping.titleNotRecorded": "Block titles",
  "mapping.titleRecorded": "Record titles",
  "mapping.unsaved": "Unsaved changes",
  "mapping.webEmptyState": "No websites match the current filter",
  "mapping.webSearchPlaceholder": "Search websites or categories"
} as const;
