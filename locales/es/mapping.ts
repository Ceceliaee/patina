// es locale resource. Pure data only.
export const MESSAGES = {
  "mapping.linkedApps": "Aplicaciones vinculadas",
  "mapping.addLinkedApp": "Añadir aplicación",
  "mapping.mainApp": "Aplicación principal",
  "mapping.unlinkApp": "Desvincular aplicación",
  "mapping.backToLinkedApps": "Volver a aplicaciones vinculadas",
  "mapping.individualControls": "Los títulos, el seguimiento y la eliminación solo afectan al programa seleccionado",
  "mapping.saveFailed": "No se pudieron guardar los cambios. Inténtalo de nuevo.",
  "mapping.deleteFailed": "No se pudo completar la eliminación de los registros. Inténtalo de nuevo.",

  "mapping.titleCaptureOnHint": "El registro de títulos está activado. Haz clic para desactivarlo.",
  "mapping.titleCaptureOffHint": "El registro de títulos está desactivado. Haz clic para activarlo.",
  "mapping.trackingOnHint": "Detener seguimiento y ocultar historial",
  "mapping.trackingOffHint": "Reanudar seguimiento y mostrar historial",

  "mapping.appSearchPlaceholder": "Buscar apps",
  "mapping.cancel": "Cancelar",
  "mapping.categoryFilter": "Filtrar por categoría",
  "mapping.categoryControl": "Gestionar categorías",
  "mapping.categoryDialogDescription": "Crea categorías y ajusta sus colores",
  "mapping.categoryDialogTitle": "Gestionar categorías",
  "mapping.categorySelectLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Categoría de ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.color": "Color",
  "mapping.createCategoryAction": "Nueva categoría",
  "mapping.createCategoryDescription": "Usa un nombre breve y fácil de reconocer.",
  "mapping.createCategoryPlaceholder": "Ejemplo: Estudio",
  "mapping.createCategoryTitle": "Nueva categoría",
  "mapping.deleteAppRecords": "Eliminar registros",
  "mapping.deleteAppSessionsDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Todos los registros de la app ",
        {
          "$op": "arg",
          "name": "label"
        },
        ", incluidos los de Patina y los importados, se eliminarán. No se modificarán los registros de otras apps ni sus datos importados."
      ]
    }
  },
  "mapping.deleteAppSessionsTitle": "Eliminar registros de la app",
  "mapping.deleteCategory": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Eliminar categoría: ",
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
        "Se eliminará la categoría ",
        {
          "$op": "arg",
          "name": "label"
        },
        "."
      ]
    }
  },
  "mapping.deleteCategoryTitle": "Eliminar categoría",
  "mapping.deleteWebDomainHistoryDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Se eliminarán los registros web de ",
        {
          "$op": "arg",
          "name": "label"
        },
        "."
      ]
    }
  },
  "mapping.deleteWebDomainHistoryTitle": "Eliminar registros web",
  "mapping.deleteWebRecords": "Eliminar registros web",
  "mapping.disableTitleCapture": "Dejar de registrar títulos",
  "mapping.disableTracking": "Detener el registro y ocultar el historial existente",
  "mapping.disableWebTracking": "Detener el registro y ocultar el historial existente",
  "mapping.editAppName": "Editar nombre de la app",
  "mapping.editWebDomainName": "Editar nombre del sitio web",
  "mapping.emptyState": "Ninguna app coincide con el filtro actual",
  "mapping.enableTitleCapture": "Reanudar registro de títulos",
  "mapping.enableTracking": "Reanudar el registro y mostrar el historial existente",
  "mapping.enableWebTracking": "Reanudar el registro y mostrar el historial existente",
  "mapping.excludeStats": "Excluir de las estadísticas",
  "mapping.filters.all": "Todo",
  "mapping.filters.classified": "Clasificados",
  "mapping.filters.other": "Sin clasificar",
  "mapping.globalTitleDisabled": "El registro global de títulos está desactivado",
  "mapping.idle": "Guardado",
  "mapping.loadFailed": "No se pudieron cargar los datos de clasificación.",
  "mapping.loading": "Cargando...",
  "mapping.noStats": "Excluido",
  "mapping.objectModeApp": "Apps",
  "mapping.objectModeWeb": "Web",
  "mapping.quickCategoryMenuLabel": "Categorías disponibles",
  "mapping.quickChangeCategory": "Cambiar categoría",
  "mapping.quickMenuLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Acciones rápidas de ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.quickRename": "Cambiar nombre",
  "mapping.quickRenamePlaceholder": "Nombre",
  "mapping.quickRenameTitle": "Cambiar nombre",
  "mapping.quickRestoreDefaultName": "Restaurar nombre predeterminado",
  "mapping.quickSave": "Guardar",
  "mapping.quickSaveFailed": "No se pudo guardar. La configuración existente no se modificó.",
  "mapping.quickSaving": "Guardando…",
  "mapping.quickSetCategory": "Asignar categoría",
  "mapping.quickUnclassified": "Sin clasificar",
  "mapping.renameCategory": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Renombrar categoría: ",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.renameCategoryDescription": "Las apps y los sitios web de esta categoría mostrarán el nuevo nombre.",
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
        " ya existe. Al continuar, esta categoría se combinará con ella."
      ]
    }
  },
  "mapping.renameCategoryDuplicateTitle": "Combinar con la categoría existente",
  "mapping.renameCategoryPlaceholder": "Nuevo nombre de categoría",
  "mapping.renameCategoryTitle": "Renombrar categoría",
  "mapping.restoreDefaultColor": "Restaurar color predeterminado",
  "mapping.restoreStats": "Incluir en las estadísticas",
  "mapping.retry": "Reintentar",
  "mapping.save": "Guardar",
  "mapping.saving": "Guardando...",
  "mapping.searchNoResults": "No se encontraron apps coincidentes",
  "mapping.statsEnabled": "Incluido",
  "mapping.subtitle": "Gestiona reglas de apps y sitios web",
  "mapping.title": "Clasificación",
  "mapping.titleNotRecorded": "No registrar títulos",
  "mapping.titleRecorded": "Registrar títulos",
  "mapping.unsaved": "Cambios sin guardar",
  "mapping.webEmptyState": "Ningún sitio web coincide con el filtro actual",
  "mapping.webSearchPlaceholder": "Buscar sitios web"
} as const;
