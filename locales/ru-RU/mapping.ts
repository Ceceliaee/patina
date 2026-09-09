// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "mapping.saveFailed": "Не удалось сохранить изменения. Повторите попытку.",
  "mapping.deleteFailed": "Не удалось завершить удаление записей. Повторите попытку.",
  "mapping.titleCaptureOnHint": "Запись заголовков включена. Нажмите, чтобы отключить.",
  "mapping.titleCaptureOffHint": "Запись заголовков отключена. Нажмите, чтобы включить.",
  "mapping.trackingOnHint": "Остановить учёт и скрыть историю",
  "mapping.trackingOffHint": "Возобновить учёт и показать историю",
  "mapping.appSearchPlaceholder": "Поиск прил.",
  "mapping.cancel": "Отмена",
  "mapping.categoryFilter": "Фильтр по категории",
  "mapping.categoryControl": "Управление категориями",
  "mapping.categoryDialogDescription": "Создание категорий и настройка цветов",
  "mapping.categoryDialogTitle": "Управление категориями",
  "mapping.categorySelectLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Категория: ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.color": "Цвет",
  "mapping.createCategoryAction": "Новая категория",
  "mapping.createCategoryDescription": "Выберите короткое и понятное название.",
  "mapping.createCategoryPlaceholder": "Например: Учёба",
  "mapping.createCategoryTitle": "Новая категория",
  "mapping.deleteAppRecords": "Удалить записи",
  "mapping.deleteAppSessionsDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Все записи приложения «",
        {
          "$op": "arg",
          "name": "label"
        },
        "», включая записи Patina и импортированные данные, будут удалены. Записи других приложений и их импортированные данные не изменятся."
      ]
    }
  },
  "mapping.deleteAppSessionsTitle": "Удалить записи прил.",
  "mapping.deleteCategory": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Удалить категорию: ",
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
        "Будет удалена категория «",
        {
          "$op": "arg",
          "name": "label"
        },
        "»."
      ]
    }
  },
  "mapping.deleteCategoryTitle": "Удалить категорию",
  "mapping.deleteWebDomainHistoryDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Будут удалены записи сайта: ",
        {
          "$op": "arg",
          "name": "label"
        },
        "."
      ]
    }
  },
  "mapping.deleteWebDomainHistoryTitle": "Удалить записи сайта",
  "mapping.deleteWebRecords": "Удалить записи сайта",
  "mapping.disableTitleCapture": "Прекратить запись заголовков",
  "mapping.disableTracking": "Прекратить учёт и скрыть имеющуюся историю",
  "mapping.disableWebTracking": "Прекратить учёт и скрыть имеющуюся историю",
  "mapping.editAppName": "Изменить название прил.",
  "mapping.editWebDomainName": "Изменить название сайта",
  "mapping.emptyState": "Нет приложений для выбранного фильтра",
  "mapping.enableTitleCapture": "Возобновить запись заголовков",
  "mapping.enableTracking": "Возобновить учёт и показать имеющуюся историю",
  "mapping.enableWebTracking": "Возобновить учёт и показать имеющуюся историю",
  "mapping.excludeStats": "Исключить из статистики",
  "mapping.filters.all": "Все",
  "mapping.filters.classified": "С категорией",
  "mapping.filters.other": "Без категории",
  "mapping.globalTitleDisabled": "Глобальная запись заголовков отключена",
  "mapping.idle": "Сохранено",
  "mapping.loadFailed": "Не удалось загрузить данные категорий.",
  "mapping.loading": "Загрузка...",
  "mapping.noStats": "Исключено",
  "mapping.objectModeApp": "Прил.",
  "mapping.objectModeWeb": "Сайты",
  "mapping.quickCategoryMenuLabel": "Доступные категории",
  "mapping.quickChangeCategory": "Изменить категорию",
  "mapping.quickMenuLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Быстрые действия: ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.quickRename": "Переименовать",
  "mapping.quickRenamePlaceholder": "Название",
  "mapping.quickRenameTitle": "Переименовать",
  "mapping.quickRestoreDefaultName": "Вернуть исходное название",
  "mapping.quickSave": "Сохранить",
  "mapping.quickSaveFailed": "Не удалось сохранить. Прежние настройки не изменены.",
  "mapping.quickSaving": "Сохранение…",
  "mapping.quickSetCategory": "Назначить категорию",
  "mapping.quickUnclassified": "Без категории",
  "mapping.renameCategory": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Переименовать категорию: ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.renameCategoryDescription": "Для приложений и сайтов этой категории будет показано новое название.",
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
        " уже существует. При продолжении текущая категория будет объединена с ней."
      ]
    }
  },
  "mapping.renameCategoryDuplicateTitle": "Объединить с существующей категорией",
  "mapping.renameCategoryPlaceholder": "Новое название категории",
  "mapping.renameCategoryTitle": "Переименовать категорию",
  "mapping.restoreDefaultColor": "Вернуть исходный цвет",
  "mapping.restoreStats": "Включить в статистику",
  "mapping.retry": "Повторить",
  "mapping.save": "Сохранить",
  "mapping.saving": "Сохранение...",
  "mapping.searchNoResults": "Подходящих приложений не найдено",
  "mapping.statsEnabled": "Учитывается",
  "mapping.subtitle": "Правила приложений и сайтов",
  "mapping.title": "Категории",
  "mapping.titleNotRecorded": "Не записывать заголовки",
  "mapping.titleRecorded": "Записывать заголовки",
  "mapping.unsaved": "Не сохранено",
  "mapping.webEmptyState": "Нет сайтов, соответствующих фильтру",
  "mapping.webSearchPlaceholder": "Поиск сайтов"
} as const;
