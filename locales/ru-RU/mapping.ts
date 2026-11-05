// ru-RU locale resource. Pure data only.
export const MESSAGES = {
  "mapping.webIndependent": "Показывать отдельно",
  "mapping.mergeWebDomain": {"$type": "message", "body": {"$op": "concat", "parts": ["Объединить в ", {"$op": "arg", "name": "domain"}]}},
  "mapping.deletionMembers": "Объекты для удаления",
  "mapping.deletionLinks": "Удаляемые связи или исключения из группировки",
  "mapping.deletionReminders": "Удаляемые напоминания",
  "mapping.deletionSharedReminders": "Общие напоминания будут сохранены",
  "mapping.deletionPendingChanges": "Сначала сохраните или отмените изменения классификации",
  "mapping.objectDeleted": "Выбранный объект удалён",

  "mapping.webLinks": "Автоматическая группа",
  "mapping.addLinkedWebDomain": "Добавить сайт",
  "mapping.backToLinkedWebDomains": "Назад к связанным сайтам",
  "mapping.mainWebDomain": "Основной сайт",

  "mapping.linkedApps": "Связанные приложения",
  "mapping.addLinkedApp": "Добавить приложение",
  "mapping.mainApp": "Основное приложение",
  "mapping.unlinkApp": "Отвязать приложение",
  "mapping.backToLinkedApps": "Назад к связанным приложениям",
  "mapping.individualControls": "Запись заголовков, отслеживание и удаление относятся только к выбранной программе",
  "mapping.saveFailed": "Не удалось сохранить изменения. Повторите попытку.",
  "mapping.deleteFailed": "Удаление не завершено. Проверьте список объектов и попробуйте снова.",
  "mapping.titleCaptureOnHint": "Запись заголовков включена. Нажмите, чтобы отключить.",
  "mapping.titleCaptureOffHint": "Запись заголовков отключена. Нажмите, чтобы включить.",
  "mapping.trackingOnHint": "Анонимный учёт",
  "mapping.trackingOffHint": "Возобновить учёт",
  "mapping.appSearchPlaceholder": "Поиск прил.",
  "mapping.cancel": "Отмена",
  "mapping.categoryFilter": "Фильтр по категории",
  "mapping.categoryControl": "Управление категориями",
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
  "mapping.createCategoryPlaceholder": "Например: Учёба",
  "mapping.createCategoryTitle": "Новая категория",
  "mapping.deleteAppRecords": "Удалить приложение",
  "mapping.deleteObjectDetail": {"$type":"message","body":{"$op":"concat","parts":["История, индивидуальные настройки и значок «",{"$op":"arg","name":"label"},"» будут удалены безвозвратно."]}},
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
  "mapping.deleteWebRecords": "Удалить сайт",
  "mapping.disableTitleCapture": "Прекратить запись заголовков",
  "mapping.disableTracking": "Прекратить учёт и скрыть имеющуюся историю",
  "mapping.disableWebTracking": "Прекратить учёт и скрыть имеющуюся историю",
  "mapping.editAppName": "Изменить название прил.",
  "mapping.editWebDomainName": "Изменить название сайта",
  "mapping.emptyState": "Нет приложений для выбранного фильтра",
  "mapping.enableTitleCapture": "Возобновить запись заголовков",
  "mapping.enableTracking": "Возобновить учёт и показать имеющуюся историю",
  "mapping.enableWebTracking": "Возобновить учёт и показать имеющуюся историю",
  "mapping.excludeStats": "Анонимный учёт",
  "mapping.filters.all": "Все",
  "mapping.filters.classified": "С категорией",
  "mapping.filters.other": "Без категории",
  "mapping.globalTitleDisabled": "Глобальная запись заголовков отключена",
  "mapping.idle": "Сохранено",
  "mapping.loadFailed": "Не удалось загрузить данные категорий.",
  "mapping.loading": "Загрузка...",
  "mapping.noStats": "Анонимный учёт",
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
  "mapping.restoreStats": "Возобновить учёт",
  "mapping.retry": "Повторить",
  "mapping.save": "Сохранить",
  "mapping.saving": "Сохранение...",
  "mapping.searchNoResults": "Подходящих приложений не найдено",
  "mapping.statsEnabled": "Учитывается",
  "mapping.title": "Категории",
  "mapping.titleNotRecorded": "Не записывать заголовки",
  "mapping.titleRecorded": "Записывать заголовки",
  "mapping.unsaved": "Не сохранено",
  "mapping.webEmptyState": "Нет сайтов, соответствующих фильтру",
  "mapping.webSearchPlaceholder": "Поиск сайтов"
} as const;
