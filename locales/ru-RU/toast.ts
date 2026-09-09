// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "toast.backupExportFailed": "Не удалось создать копию. Проверьте место сохранения и повторите попытку.",
  "toast.backupExportSuccess": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Копия создана: ",
        {
          "$op": "arg",
          "name": "path"
        },
        ""
      ]
    }
  },
  "toast.backupIncompatible": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Копия несовместима: ",
        {
          "$op": "coalesce",
          "left": {
            "$op": "arg",
            "name": "reason"
          },
          "right": "не удалось подтвердить совместимость"
        },
        ""
      ]
    }
  },
  "toast.backupPreviewFailed": "Не удалось открыть предпросмотр копии. Проверьте файл и повторите попытку.",
  "toast.backupRestoreFailed": "Восстановление не завершено. Приложение сохранило или восстановило исходные данные, где это было возможно. Сохраните журналы диагностики, если требуется перезапуск или запись недоступна.",
  "toast.backupRestoreSuccess": "Копия восстановлена. Обновление…",
  "toast.cleanupFailed": "Не удалось очистить историю. Повторите позже.",
  "toast.cleanupSuccess": "История очищена.",
  "toast.feedbackOpenFailed": "Не удалось открыть ссылку для обратной связи.",
  "toast.legacyBackupRestoreSuccess": "Копия прежнего формата восстановлена. Создайте новую резервную копию снимка данных SQLite.",
  "toast.releaseNotesOpenFailed": "Не удалось открыть описание выпуска.",
  "toast.repositoryOpenFailed": "Не удалось открыть ссылку GitHub.",
  "toast.settingsRuntimeSyncPartial": "Настройки сохранены. Часть изменений вступит в силу после следующего обновления интерфейса.",
  "toast.supportOpenFailed": "Не удалось открыть ссылку для поддержки.",
  "toast.webDavConfigDeleted": "Настройки WebDAV удалены.",
  "toast.webDavConfigDeleteFailed": "Не удалось удалить настройки WebDAV. Повторите позже.",
  "toast.webDavConfigSaved": "Настройки WebDAV сохранены.",
  "toast.webDavConfigSaveFailed": "Не удалось сохранить настройки WebDAV. Проверьте их и повторите попытку.",
  "toast.webDavDownloadFailed": "Не удалось скачать или восстановить удалённую копию. Локальные данные не изменились.",
  "toast.webDavListFailed": "Не удалось получить список удалённых копий.",
  "toast.webDavMissingConfig": "Сначала настройте WebDAV и сохраните пароль.",
  "toast.webDavMissingPassword": "Введите пароль WebDAV или пароль приложения.",
  "toast.webDavTestFailed": "Не удалось подключиться к WebDAV. Проверьте адрес, имя пользователя и пароль приложения.",
  "toast.webDavTestSuccess": "Подключение WebDAV доступно.",
  "toast.webDavUploadFailed": "Не удалось загрузить удалённую копию. Локальные данные не изменились.",
  "toast.webDavUploadIndexWarning": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Удалённая копия загружена: ",
        {
          "$op": "arg",
          "name": "fileName"
        },
        ", но обновить список не удалось."
      ]
    }
  },
  "toast.webDavUploadSuccess": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Удалённая копия загружена: ",
        {
          "$op": "arg",
          "name": "fileName"
        },
        ""
      ]
    }
  }
} as const;
