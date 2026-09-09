// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "settings.appearanceTitle": "Внешний вид",
  "settings.backgroundOptimizationHint": "Освобождать память интерфейса при простое в фоне. Окно может открываться немного дольше.",
  "settings.backgroundOptimizationLabel": "Экономия памяти в фоне",
  "settings.backupExportAction": "Создать копию",
  "settings.backupExportHint": "Экспортировать снимок текущих данных.",
  "settings.backupExporting": "Создание копии…",
  "settings.backupExportTitle": "Создать копию",
  "settings.backupRestoreAction": "Восстановить",
  "settings.backupRestoreActionHelp": "Прежний формат: резервная копия структурированных данных\nТекущий формат: снимок данных SQLite\nВосстановление прежнего формата поддерживается до 18 октября 2026 г.",
  "settings.backupRestoreActionHint": "Восстановить данные из резервной копии.",
  "settings.backupRestoreActionTitle": "Восстановить",
  "settings.backupRestoreHint": "Сохраняйте резервные копии. При восстановлении можно заменить текущие данные или объединить их с копией.",
  "settings.backupRestoreTitle": "Резервное копирование и восстановление",
  "settings.backupRestoring": "Восстановление…",
  "settings.backupTargetHint": "Сохранить локальный файл или загрузить его на подключённый сервер WebDAV.",
  "settings.backupTargetLocalHint": "Сохранить в локальный ZIP-файл.",
  "settings.backupTargetLocalTitle": "Локальная копия",
  "settings.backupTargetRemoteHint": "Загрузить на подключённый сервер WebDAV.",
  "settings.backupTargetRemoteTitle": "Копия в WebDAV",
  "settings.backupTargetTitle": "Выберите место для копии",
  "settings.betaLabel": "Бета",
  "settings.cancel": "Отмена",
  "settings.cancelled": "Изменения отменены",
  "settings.cleanup": "Управление данными",
  "settings.cleanupConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Все записи приложений и сайтов за ",
        {
          "$op": "arg",
          "name": "label"
        },
        " и более ранние даты будут удалены, включая импортированные записи."
      ]
    }
  },
  "settings.cleanupConfirmTitle": "Подтвердите очистку истории",
  "settings.cleanupHint": "Удалить записи приложений и сайтов за выбранную дату и ранее, включая импортированные записи. Это действие нельзя отменить.",
  "settings.cleanupNow": "Очистить",
  "settings.cleanupRangeLabel": "Граница очистки",
  "settings.cleanupRangeLabels": {
    "7": "7 дней назад",
    "15": "15 дней назад",
    "30": "30 дней назад",
    "60": "60 дней назад",
    "90": "90 дней назад",
    "180": "180 дней назад"
  },
  "settings.cleanupRunning": "Очистка…",
  "settings.cleanupTitle": "Очистить историю",
  "settings.closeToTrayHint": "При закрытии скрывать главное окно и продолжать работу в фоне.",
  "settings.closeToTrayLabel": "Закрывать в трей",
  "settings.colorSchemeDialogDescription": "Изменения видны сразу. Подтвердите, чтобы сохранить.",
  "settings.colorSchemeDialogFallbackTitle": "Тема",
  "settings.colorSchemeHint": "Настраивайте цвета светлой и тёмной тем отдельно.",
  "settings.colorSchemeLabel": "Цветовая схема",
  "settings.colorSchemeSaving": "Сохранение",
  "settings.confirmRangeFallback": "выбранный период",
  "settings.dataExportAction": "Экспорт",
  "settings.dataExportActionHint": "Экспортировать нужные записи активности.",
  "settings.dataExportHint": "Экспорт записей активности и импорт данных из других источников.",
  "settings.dataExportTitle": "Экспорт и импорт",
  "settings.dataImport.availableLabel": "Готово к импорту",
  "settings.dataImport.batchesDescription": "Будет удалён только выбранный пакет импорта. Собственные данные Patina не изменятся.",
  "settings.dataImport.batchesTitle": "Удалить импортированные данные",
  "settings.dataImport.batchTitle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Импорт ",
        {
          "$op": "arg",
          "name": "number"
        },
        ""
      ]
    }
  },
  "settings.dataImport.categorizedAppsLabel": "Прил. с категориями",
  "settings.dataImport.categoryConflictNote": "Приложения с несколькими категориями останутся без категории. Их можно распределить позже.",
  "settings.dataImport.conflictedAppsLabel": "Конфликты категорий",
  "settings.dataImport.csvHint": "Выберите CSV-файл канонического формата для импорта.",
  "settings.dataImport.csvTitle": "Импортировать CSV",
  "settings.dataImport.deleteBatchAction": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Удалить импорт ",
        {
          "$op": "arg",
          "name": "number"
        },
        ""
      ]
    }
  },
  "settings.dataImport.deleteConfirmAction": "Удалить",
  "settings.dataImport.deleteConfirmDescription": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Все внешние записи из ",
        {
          "$op": "arg",
          "name": "sourceName"
        },
        " будут удалены. Это действие нельзя отменить."
      ]
    }
  },
  "settings.dataImport.deleteConfirmTitle": "Удалить этот импорт?",
  "settings.dataImport.deleteSuccess": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "one": {
          "$op": "concat",
          "parts": [
            "Удалено внешних записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            ""
          ]
        },
        "other": {
          "$op": "concat",
          "parts": [
            "Удалено внешних записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            ""
          ]
        },
        "many": {
          "$op": "concat",
          "parts": [
            "Удалено внешних записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            ""
          ]
        },
        "few": {
          "$op": "concat",
          "parts": [
            "Удалено внешних записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            ""
          ]
        }
      }
    }
  },
  "settings.dataImport.destructureFormatsHint": "Поддерживаются:\nФайлы CSV (.csv): Tai\nФайлы SQLite (.db, .sqlite): Tai, Taix",
  "settings.dataImport.destructureHint": "Преобразовать внешний файл в CSV канонического формата.",
  "settings.dataImport.destructureTitle": "Преобразование данных",
  "settings.dataImport.destructureSuccess": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "one": {
          "$op": "concat",
          "parts": [
            "Создано записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            "; файл: ",
            {
              "$op": "arg",
              "name": "path"
            }
          ]
        },
        "other": {
          "$op": "concat",
          "parts": [
            "Создано записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            "; файл: ",
            {
              "$op": "arg",
              "name": "path"
            }
          ]
        },
        "many": {
          "$op": "concat",
          "parts": [
            "Создано записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            "; файл: ",
            {
              "$op": "arg",
              "name": "path"
            }
          ]
        },
        "few": {
          "$op": "concat",
          "parts": [
            "Создано записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            "; файл: ",
            {
              "$op": "arg",
              "name": "path"
            }
          ]
        }
      }
    }
  },
  "settings.dataImport.detailSeparator": ": ",
  "settings.dataImport.dialogDescription": "Импортируйте CSV канонического формата или сначала преобразуйте внешние данные.",
  "settings.dataImport.dialogTitle": "Выберите способ импорта",
  "settings.dataImport.duplicateLabel": "Повторяющиеся записи",
  "settings.dataImport.errorLabel": "Некорректные записи",
  "settings.dataImport.exactLabel": "Точные записи",
  "settings.dataImport.fileLabel": "Файл импорта",
  "settings.dataImport.hourLabel": "Почасовые итоги",
  "settings.dataImport.importSuccess": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "one": {
          "$op": "concat",
          "parts": [
            "Импортировано записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            ""
          ]
        },
        "other": {
          "$op": "concat",
          "parts": [
            "Импортировано записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            ""
          ]
        },
        "many": {
          "$op": "concat",
          "parts": [
            "Импортировано записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            ""
          ]
        },
        "few": {
          "$op": "concat",
          "parts": [
            "Импортировано записей: ",
            {
              "$op": "arg",
              "name": "count"
            },
            ""
          ]
        }
      }
    }
  },
  "settings.dataImport.lineError": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Строка ",
        {
          "$op": "arg",
          "name": "line"
        },
        ": ",
        {
          "$op": "arg",
          "name": "message"
        },
        ""
      ]
    }
  },
  "settings.dataImport.previewTitle": "Предпросмотр импорта",
  "settings.dataImportAction": "Импорт",
  "settings.dataImportActionHint": "Импортировать или преобразовать внешние данные.",
  "settings.dataSafetyTitle": "Хранилище",
  "settings.decreaseCleanupRange": "Сократить период очистки",
  "settings.decreaseMinute": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Уменьшить ",
        {
          "$op": "arg",
          "name": "label"
        },
        " на 1 минуту"
      ]
    }
  },
  "settings.dynamicEffectsHint": "Показывать анимацию при смене разделов и взаимодействии с интерфейсом.",
  "settings.dynamicEffectsLabel": "Анимация",
  "settings.globalTitleHint": "Сохранять заголовки окон и веб-страниц в истории активности.",
  "settings.globalTitleLabel": "Запись заголовков",
  "settings.idle": "Сохранено",
  "settings.idleTimeoutHint": "Продолжать учёт при воспроизведении звука или других признаках активности текущего приложения.",
  "settings.idleTimeoutLabel": "Продолжать учёт",
  "settings.importRecordCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Импортированных записей: ",
        {
          "$op": "arg",
          "name": "count"
        }
      ]
    }
  },
  "settings.increaseCleanupRange": "Расширить период очистки",
  "settings.increaseMinute": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Увеличить ",
        {
          "$op": "arg",
          "name": "label"
        },
        " на 1 минуту"
      ]
    }
  },
  "settings.languageHint": "Выберите язык интерфейса.",
  "settings.languageLabel": "Язык",
  "settings.languageLoadFailed": "Язык недоступен. Сохранён текущий язык.",
  "settings.languageOptions.enUS": "English",
  "settings.languageOptions.zhCN": "中文",
  "settings.launchAtLoginHint": "Автоматически запускать приложение после входа в Windows.",
  "settings.launchAtLoginLabel": "Запускать с Windows",
  "settings.loadFailed": "Не удалось загрузить настройки.",
  "settings.loading": "Загрузка настроек…",
  "settings.minimizeToWidgetHint": "При сворачивании скрывать главное окно и показывать боковой виджет.",
  "settings.minimizeToWidgetLabel": "Сворачивать в виджет",
  "settings.minuteValue": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " мин"
      ]
    }
  },
  "settings.remoteBackupHint": "Подключите WebDAV для удалённого резервного копирования.",
  "settings.remoteBackupTitle": "Настройка WebDAV",
  "settings.remoteStatusBridgeEnabledHint": "Отправлять текущее состояние учёта на указанный адрес.",
  "settings.remoteStatusBridgeMachineIdLabel": "ID устройства",
  "settings.remoteStatusBridgeTitle": "Удалённая отправка",
  "settings.remoteStatusBridgeTokenLabel": "Token",
  "settings.remoteStatusBridgeUrlLabel": "URL получателя",
  "settings.residentTitle": "В фоне",
  "settings.restoreConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Способ восстановления: ",
        {
          "$op": "arg",
          "name": "strategy"
        },
        "\nЦелевой файл: ",
        {
          "$op": "arg",
          "name": "path"
        },
        "\n\n",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "settings.restoreConfirmTitle": "Восстановить копию",
  "settings.restoreSourceHint": "Выберите локальную копию или скачайте её с подключённого сервера WebDAV.",
  "settings.restoreSourceLocalHint": "Выберите локальный ZIP-файл.",
  "settings.restoreSourceLocalTitle": "Локальное восстановление",
  "settings.restoreSourceRemoteHint": "Выберите резервную копию в WebDAV.",
  "settings.restoreSourceRemoteTitle": "Восстановление из WebDAV",
  "settings.restoreSourceTitle": "Выберите источник восстановления",
  "settings.restoreStrategyHint": "Выберите, что сделать с текущими данными при восстановлении.",
  "settings.restoreStrategyLabel": "Способ восстановления",
  "settings.restoreStrategyOptionHints.merge": "Сохранить текущие данные и удалить дубликаты",
  "settings.restoreStrategyOptionHints.replace": "После восстановления оставить только данные из копии",
  "settings.restoreStrategyOptions.merge": "Объединить",
  "settings.restoreStrategyOptions.replace": "Заменить",
  "settings.retry": "Повторить",
  "settings.save": "Сохранить",
  "settings.saved": "Настройки обновлены",
  "settings.saveFailed": "Не удалось сохранить настройки. Повторите позже.",
  "settings.scheduledBackupCleanupWarning": "Последняя копия исправна, но предыдущую автоматическую копию пока не удалось удалить. Patina повторит попытку позже.",
  "settings.scheduledBackupLabels": {
    "directory": "Сохранять в",
    "frequency": "Периодичность",
    "nextExecution": "Следующий запуск",
    "recentFailure": "Последняя ошибка",
    "recentSuccess": "Последний успешный запуск",
    "time": "Время",
    "title": "Копирование по расписанию"
  },
  "settings.saving": "Сохранение...",
  "settings.servicesTitle": "Службы",
  "settings.startMinimizedHint": "После запуска скрывать главное окно в системном трее.",
  "settings.startMinimizedLabel": "Запускать в фоне",
  "settings.storage.changePathAction": "Изменить расположение",
  "settings.storage.dataDirectoryLabel": "Папка данных",
  "settings.storage.installDirectoryLabel": "Папка установки",
  "settings.storage.openDirectoryAction": "Открыть папку",
  "settings.storage.restartAndApplyAction": "Перезапустить и применить",
  "settings.storage.restoreDefaultPathAction": "Вернуть стандартное расположение",
  "settings.storage.storageCacheMigrationConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Текущий кэш: ",
        {
          "$op": "arg",
          "name": "currentWebviewRoot"
        },
        "\nНовый кэш: ",
        {
          "$op": "arg",
          "name": "targetWebviewRoot"
        },
        "\n\nPatina сохранит текущую запись, перезапустится и начнёт использовать новую папку кэша. До завершения не перемещайте и не удаляйте новую папку."
      ]
    }
  },
  "settings.storage.storageCacheMigrationConfirmTitle": "Изменить папку кэша",
  "settings.storage.storageDataMigrationConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Текущая папка: ",
        {
          "$op": "arg",
          "name": "currentDataRoot"
        },
        "\nНовая папка: ",
        {
          "$op": "arg",
          "name": "targetDataRoot"
        },
        "\n\nPatina сохранит текущую запись, перезапустится и перенесёт данные в новую папку. До завершения переноса не перемещайте и не удаляйте ни одну из папок."
      ]
    }
  },
  "settings.storage.storageDataMigrationConfirmTitle": "Изменить папку данных",
  "settings.storage.storageDirectorySummary": "Папка приложения задаётся при установке. Папки данных и кэша можно изменить.",
  "settings.storage.storageDirectoryTitle": "Локальные пути",
  "settings.storage.storageMigrationFailed": "Не удалось подготовить перезапуск. Проверьте целевую папку.",
  "settings.storage.storageOpenDirectoryFailed": "Не удалось открыть папку.",
  "settings.storage.storageRestoreDefaultCacheConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Текущий кэш: ",
        {
          "$op": "arg",
          "name": "currentWebviewRoot"
        },
        "\nСтандартный кэш: ",
        {
          "$op": "arg",
          "name": "defaultWebviewRoot"
        },
        "\n\nPatina сохранит текущую запись, перезапустится и вернёт стандартную папку кэша. До завершения не перемещайте и не удаляйте стандартную папку."
      ]
    }
  },
  "settings.storage.storageRestoreDefaultDataConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Текущие данные: ",
        {
          "$op": "arg",
          "name": "currentDataRoot"
        },
        "\nСтандартная папка данных: ",
        {
          "$op": "arg",
          "name": "defaultDataRoot"
        },
        "\n\nPatina сохранит текущую запись, перезапустится и перенесёт данные в стандартную папку. До завершения переноса не перемещайте и не удаляйте ни одну из папок."
      ]
    }
  },
  "settings.storage.storageSnapshotRefreshAction": "Проверить хранилище",
  "settings.storage.storageSnapshotRefreshFailed": "Не удалось проверить папки хранилища.",
  "settings.storage.webviewCacheClearConfirmDetail": "Patina сохранит текущую запись, перезапустится и очистит восстанавливаемый кэш WebView перед созданием окна.",
  "settings.storage.webviewCacheClearConfirmTitle": "Перезапустить и очистить кэш?",
  "settings.storage.webviewCacheClearFailed": "Не удалось подготовить очистку кэша. Повторите попытку.",
  "settings.storage.webviewCacheClearTitle": "Очистить кэш",
  "settings.storage.webviewCacheDirectoryLabel": "Папка кэша",
  "settings.subtitle": "Настройте общие параметры работы",
  "settings.themeLibraryOptions.dark": "Тёмная тема",
  "settings.themeLibraryOptions.light": "Светлая тема",
  "settings.themeModeHint": "Светлая, тёмная или как в системе.",
  "settings.themeModeLabel": "Режим темы",
  "settings.themeModeOptions.dark": "Тёмная",
  "settings.themeModeOptions.light": "Светлая",
  "settings.themeModeOptions.system": "Система",
  "settings.timelineMergeGapHint": "При бездействии учёт приостанавливается. Короткие переключения приложений не прерывают запись.",
  "settings.timelineMergeGapLabel": "Удержание активности",
  "settings.title": "Настройки",
  "settings.tracking": "Учёт",
  "settings.trackingPanelTitle": "Учёт",
  "settings.trackingPausedHint": "На паузе новые записи не сохраняются.",
  "settings.trackingPausedLabel": "Приостановить учёт",
  "settings.unsaved": "Не сохранено",
  "settings.webActivityAddressLabel": "Порт",
  "settings.webActivityEnabledHint": "Получать активные веб-страницы из расширения браузера.",
  "settings.webActivityHelpAction": "Инструкция",
  "settings.webActivityHelpCopiedAction": "Скопировано",
  "settings.webActivityHelpCopyPortAction": "Скопировать порт",
  "settings.webActivityHelpCopyTokenAction": "Скопировать токен",
  "settings.webActivityHelpDescription": "Patina Web Sync передаёт сведения об активной веб-странице в локальное приложение Patina.",
  "settings.webActivityHelpNote": "После включения и подключения Patina Web Sync:\n• Автоматически передаёт адрес, заголовок и значок сайта активной вкладки.\n• Не читает содержимое страниц, значения форм, снимки экрана или буфер обмена.\n• Не просматривает и не импортирует историю браузера.\n• Не сохраняет приватные окна в записях сайтов.",
  "settings.webActivityHelpSteps": [
    {
      "title": "Подготовьте параметры подключения",
      "description": "Расширение использует порт и токен с этой страницы для подключения к локальному приложению Patina.",
      "details": [
        "Скопируйте порт и токен, чтобы затем вставить их в настройки расширения."
      ]
    },
    {
      "title": "Установите расширение браузера",
      "description": "Выберите браузер и установите Patina Web Sync из его магазина.",
      "showStoreBadges": true,
      "details": [
        {
          "text": "Если магазин недоступен, установите расширение вручную со страницы выпусков Patina Web Sync.",
          "links": [
            {
              "label": "Открыть выпуски",
              "href": "https://github.com/Ceceliaee/patina-web-sync/releases/latest"
            }
          ]
        }
      ]
    },
    {
      "title": "Настройте расширение",
      "description": "Откройте настройки Patina Web Sync и введите параметры подключения с этой страницы.",
      "details": [
        "Откройте меню расширений на панели браузера.",
        "Найдите и откройте Patina Web Sync.",
        "Нажмите «Настройки» во всплывающем окне расширения.",
        "Вставьте порт и токен с этой страницы.",
        "Также можно открыть страницу управления расширениями: найдите Patina Web Sync, откройте сведения о нём, затем параметры расширения."
      ]
    },
    {
      "title": "Синхронизируйте текущую страницу",
      "description": "После открытия обычной веб-страницы расширение синхронизирует активную страницу.",
      "details": [
        "Откройте веб-страницу http/https.",
        "Дождитесь автоматической синхронизации текущей страницы через Patina Web Sync.",
        "Для немедленной синхронизации нажмите «Синхронизировать страницу» во всплывающем окне расширения."
      ]
    }
  ],
  "settings.webActivityHelpTitle": "Инструкция по синхронизации сайтов",
  "settings.webActivityTitle": "Синхронизация сайтов",
  "settings.webActivityTokenLabel": "Token",
  "settings.webDavConfigDescription": "Используется только для удалённых резервных копий, а не для облачной синхронизации.",
  "settings.webDavConfigTitle": "Настройка WebDAV",
  "settings.webDavConfigure": "Настроить",
  "settings.webDavDeleteAction": "Удалить",
  "settings.webDavDeleteDetail": "Будут удалены только локальные настройки и пароль WebDAV. Удалённые резервные копии сохранятся.",
  "settings.webDavDeleteTitle": "Удалить настройки WebDAV",
  "settings.webDavEdit": "Изменить",
  "settings.webDavPassword": "Пароль прил.",
  "settings.webDavRemoteBackupsDescription": "Выберите удалённую копию. Она будет скачана и проверена на совместимость; затем вы сможете подтвердить восстановление.",
  "settings.webDavRemoteBackupsEmpty": "Нет удалённых резервных копий.",
  "settings.webDavRemoteBackupsTitle": "Удалённые копии",
  "settings.webDavRestoreSelected": "Восстановить",
  "settings.webDavServerUrl": "Адрес сервера",
  "settings.webDavTestConnection": "Проверить подключение",
  "settings.webDavTesting": "Проверка…",
  "settings.webDavUsername": "Имя пользователя"
} as const;
