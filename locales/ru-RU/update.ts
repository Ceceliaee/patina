// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "update.appUpdate": "Обновления прил.",
  "update.checkAgain": "Проверить снова",
  "update.checkErrorDetail": "Не удалось получить манифест обновления. Возможно, GitHub недоступен в текущей сети. Повторите позже или скачайте обновление вручную.",
  "update.checkFailed": "Не удалось проверить обновления",
  "update.checkFailedDialog": "Не удалось проверить обновления",
  "update.checking": "Проверка…",
  "update.checkingUpdates": "Поиск обновлений…",
  "update.checkUpdates": "Проверить обновления",
  "update.dialogAvailable": "Доступна новая версия",
  "update.dialogAvailableDetail": "Доступна новая версия. Сначала скачайте её, затем подтвердите установку.",
  "update.dialogDownloaded": "Обновление скачано",
  "update.dialogDownloadedDetail": "Пакет обновления готов. Подтвердите перезапуск для завершения установки.",
  "update.dialogDownloading": "Скачивание обновления",
  "update.dialogDownloadingDetail": "Пакет обновления скачивается. По завершении появится подтверждение установки.",
  "update.dialogInstalling": "Установка обновления",
  "update.dialogInstallingDetail": "Установка началась. Не закрывайте приложение; оно перезапустится по завершении.",
  "update.downloadedBytes": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Скачано: ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "update.downloadedDetail": "Пакет обновления скачан. Подтвердите перезапуск и установку.",
  "update.downloadedTitle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Обновление скачано: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.downloadErrorDetail": "Найдена новая версия, но автоматическое скачивание не удалось. Можно скачать её вручную.",
  "update.downloadFailed": "Не удалось скачать установщик",
  "update.downloadFailedDialog": "Ошибка скачивания",
  "update.downloading": "Скачивание обновления…",
  "update.downloadInstaller": "Скачать установщик",
  "update.downloadNow": "Скачать сейчас",
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
        " Подробности: ",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "update.feedback": "Обратная связь",
  "update.foundVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Новая версия: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.genericErrorDetail": "Не удалось завершить обновление. Повторите позже.",
  "update.installAgain": "Установить снова",
  "update.installErrorDetail": "Пакет обновления скачан, но установка не завершена. Повторите установку или скачайте пакет заново.",
  "update.installFailed": "Не удалось установить обновление",
  "update.installFailedDialog": "Ошибка установки",
  "update.installing": "Установка обновления…",
  "update.installingProgress": "Обновление устанавливается. Приложение скоро перезапустится.",
  "update.installRestartDetail": "После установки приложение перезапустится.",
  "update.later": "Позже",
  "update.manualDownload": "Скачать вручную",
  "update.notChecked": "Не проверено",
  "update.packageDownloaded": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "notEq",
        "left": {
          "$op": "coalesce",
          "left": {
            "$op": "arg",
            "name": "value"
          },
          "right": ""
        },
        "right": ""
      },
      "then": {
        "$op": "concat",
        "parts": [
          "Пакет ",
          {
            "$op": "arg",
            "name": "value"
          },
          " скачан"
        ]
      },
      "else": "Пакет скачан"
    }
  },
  "update.preparingPackage": "Подготовка пакета обновления.",
  "update.processing": "Обработка...",
  "update.progressPending": "Получение состояния",
  "update.redownloadInstaller": "Скачать снова",
  "update.releaseNotes": "Описание выпуска",
  "update.restartInstall": "Перезапустить для установки",
  "update.sidebarEntry": "Обновить",
  "update.support": "Поддержать",
  "update.targetVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Новая версия: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.unknownVersion": "неизвестная версия",
  "update.updateFailed": "Ошибка обновления",
  "update.updateFailedDialog": "Ошибка обновления",
  "update.updateProcessFailed": "Не удалось завершить обновление.",
  "update.updateReadyDetail": "Доступна новая версия. Подтвердите скачивание.",
  "update.upToDate": "Установлена актуальная версия"
} as const;
