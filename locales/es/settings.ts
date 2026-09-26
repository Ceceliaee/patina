// es locale resource. Pure data only.
export const MESSAGES = {
  "settings.timeRulesTitle": "Reglas de tiempo",
  "settings.recordingOptionsTitle": "Opciones de registro",
  "settings.themeGroupTitle": "Tema",
  "settings.interfaceGroupTitle": "Interfaz",
  "settings.windowBehaviorTitle": "Comportamiento de la ventana",
  "settings.runtimeBehaviorTitle": "Comportamiento de ejecución",
  "settings.showTrayIconLabel": "Mostrar icono en la bandeja",
"settings.webDavUploadTitle": "Subir copia de seguridad",
"settings.webDavUploadDescription": "Confirma la ubicación y el nombre del archivo antes de subirlo.",
"settings.webDavUploadAction": "Subir",
"settings.webDavFileName": "Nombre del archivo",
"settings.webDavInvalidFileName": "Introduce un nombre ZIP válido, sin rutas ni caracteres reservados.",
"settings.webDavNameConflict": "Ya existe un archivo con este nombre. Cámbialo e inténtalo de nuevo.",
"settings.webDavTargetChanged": "La configuración ha cambiado. Cierra el diálogo y confirma de nuevo la ubicación.",
"settings.webDavDirectoryFailed": "No se pudo preparar la carpeta remota. Comprueba la dirección, los permisos y la red.",
"settings.webDavUploadUncertain": "No se pudo confirmar la subida. Comprueba la carpeta remota y la red. No se sobrescribirán archivos; los datos locales no han cambiado.",
  "settings.appearanceTitle": "Apariencia",
  "settings.backgroundOptimizationHint": "Libera memoria de la interfaz cuando está inactiva en segundo plano. Reabrirla puede tardar más.",
  "settings.backgroundOptimizationLabel": "Ahorrar memoria",
  "settings.backupExportAction": "Crear copia",
  "settings.backupExporting": "Creando copia...",
  "settings.backupExportTitle": "Copia de seguridad",
  "settings.backupRestoreAction": "Restaurar",
  "settings.backupRestoreActionHelp": "Formato anterior: copia de datos estructurados\nFormato actual: instantánea de datos SQLite\nRestauración del formato anterior disponible hasta: 18 de octubre de 2026",
  "settings.backupRestoreActionTitle": "Restaurar",
  "settings.backupRestoreTitle": "Copias de seguridad y restauración",
  "settings.backupRestoring": "Restaurando...",
  "settings.backupTargetLocalHint": "Guarda como archivo ZIP local.",
  "settings.backupTargetLocalTitle": "Copia local",
  "settings.backupTargetRemoteHint": "Sube al destino WebDAV configurado.",
  "settings.backupTargetRemoteTitle": "Copia en WebDAV",
  "settings.backupTargetTitle": "Elegir ubicación de la copia",
  "settings.betaLabel": "Beta",
  "settings.cancel": "Cancelar",
  "settings.cancelled": "Cambios descartados",
  "settings.cleanup": "Gestión de datos",
  "settings.cleanupConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Todos los registros de apps y sitios web de ",
        {
          "$op": "arg",
          "name": "label"
        },
        " y fechas anteriores se eliminarán, incluidos los registros importados."
      ]
    }
  },
  "settings.cleanupConfirmTitle": "Confirmar eliminación del historial",
  "settings.cleanupHint": "Elimina los registros de apps y sitios web de la fecha seleccionada y anteriores, incluidos los importados. Esta acción no se puede deshacer.",
  "settings.cleanupNow": "Eliminar",
  "settings.cleanupRangeLabel": "Fecha límite de eliminación",
  "settings.cleanupRangeLabels": {
    "7": "Hace 7 días",
    "15": "Hace 15 días",
    "30": "Hace 30 días",
    "60": "Hace 60 días",
    "90": "Hace 90 días",
    "180": "Hace 180 días"
  },
  "settings.cleanupRunning": "Eliminando...",
  "settings.cleanupTitle": "Eliminar registros del historial",
  "settings.closeToTrayLabel": "Ocultar al cerrar",
  "settings.colorSchemeDialogFallbackTitle": "Tema",
  "settings.colorSchemeLabel": "Colores",
  "settings.colorSchemeSaving": "Guardando",
  "settings.confirmRangeFallback": "intervalo seleccionado",
  "settings.dataExportAction": "Exportar",
  "settings.dataExportTitle": "Exportación e importación",
  "settings.dataImport.availableLabel": "Listo para importar",
  "settings.dataImport.batchesDescription": "Solo se elimina el lote de importación seleccionado. Los datos nativos de Patina no se modifican.",
  "settings.dataImport.batchesTitle": "Eliminar datos externos importados",
  "settings.dataImport.batchTitle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Importación ",
        {
          "$op": "arg",
          "name": "number"
        },
        ""
      ]
    }
  },
  "settings.dataImport.categorizedAppsLabel": "Apps con categorías",
  "settings.dataImport.categoryConflictNote": "Las apps con varias categorías quedan sin clasificar y se pueden asignar después.",
  "settings.dataImport.conflictedAppsLabel": "Conflictos de categorías",
  "settings.dataImport.csvHint": "Elige un CSV con el formato requerido por Patina.",
  "settings.dataImport.csvTitle": "Importar CSV",
  "settings.dataImport.deleteBatchAction": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Eliminar importación ",
        {
          "$op": "arg",
          "name": "number"
        },
        ""
      ]
    }
  },
  "settings.dataImport.deleteConfirmAction": "Eliminar",
  "settings.dataImport.deleteConfirmDescription": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Todos los registros externos de ",
        {
          "$op": "arg",
          "name": "sourceName"
        },
        " se eliminarán. Esta acción no se puede deshacer."
      ]
    }
  },
  "settings.dataImport.deleteConfirmTitle": "¿Eliminar esta importación?",
  "settings.dataImport.deleteSuccess": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "one": {
          "$op": "concat",
          "parts": [
            "Eliminado: ",
            {
              "$op": "arg",
              "name": "count"
            },
            " registro externo"
          ]
        },
        "other": {
          "$op": "concat",
          "parts": [
            "Eliminados: ",
            {
              "$op": "arg",
              "name": "count"
            },
            " registros externos"
          ]
        },
        "many": {
          "$op": "concat",
          "parts": [
            "Eliminados: ",
            {
              "$op": "arg",
              "name": "count"
            },
            " registros externos"
          ]
        }
      }
    }
  },
  "settings.dataImport.destructureFormatsHint": "Formatos admitidos:\nArchivos CSV (.csv): Tai\nArchivos SQLite (.db, .sqlite): Tai, Taix",
  "settings.dataImport.destructureHint": "Convierte un archivo externo al formato CSV de Patina.",
  "settings.dataImport.destructureTitle": "Convertir archivo",
  "settings.dataImport.destructureSuccess": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "one": {
          "$op": "concat",
          "parts": [
            "Generado: ",
            {
              "$op": "arg",
              "name": "count"
            },
            " registro: ",
            {
              "$op": "arg",
              "name": "path"
            }
          ]
        },
        "other": {
          "$op": "concat",
          "parts": [
            "Generados: ",
            {
              "$op": "arg",
              "name": "count"
            },
            " registros: ",
            {
              "$op": "arg",
              "name": "path"
            }
          ]
        },
        "many": {
          "$op": "concat",
          "parts": [
            "Generados: ",
            {
              "$op": "arg",
              "name": "count"
            },
            " registros: ",
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
  "settings.dataImport.dialogTitle": "Importar datos",
  "settings.dataImport.duplicateLabel": "Registros duplicados",
  "settings.dataImport.errorLabel": "Registros no válidos",
  "settings.dataImport.exactLabel": "Registros exactos",
  "settings.dataImport.fileLabel": "Archivo de importación",
  "settings.dataImport.hourLabel": "Totales por hora",
  "settings.dataImport.importSuccess": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "one": {
          "$op": "concat",
          "parts": [
            "Importado: ",
            {
              "$op": "arg",
              "name": "count"
            },
            " registro"
          ]
        },
        "other": {
          "$op": "concat",
          "parts": [
            "Importados: ",
            {
              "$op": "arg",
              "name": "count"
            },
            " registros"
          ]
        },
        "many": {
          "$op": "concat",
          "parts": [
            "Importados: ",
            {
              "$op": "arg",
              "name": "count"
            },
            " registros"
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
        "Línea ",
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
  "settings.dataImport.previewTitle": "Vista previa de importación",
  "settings.dataImportAction": "Importar",
  "settings.dataSafetyTitle": "Almacenamiento",
  "settings.decreaseCleanupRange": "Reducir intervalo de eliminación",
  "settings.decreaseMinute": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Reducir ",
        {
          "$op": "arg",
          "name": "label"
        },
        " en un minuto"
      ]
    }
  },
  "settings.dynamicEffectsLabel": "Animaciones",
  "settings.globalTitleHint": "Guarda los títulos de ventanas y páginas web en los detalles del historial de actividad.",
  "settings.globalTitleLabel": "Registro global de títulos",
  "settings.idle": "Guardado",
  "settings.idleTimeoutHint": "Sigue contando el tiempo si la app actual tiene audio u otras señales similares.",
  "settings.idleTimeoutLabel": "Continuar contando",
  "settings.importRecordCount": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "eq",
        "left": {
          "$op": "arg",
          "name": "count"
        },
        "right": 1
      },
      "then": {
        "$op": "concat",
        "parts": [
          {
            "$op": "arg",
            "name": "count"
          },
          " registro importado"
        ]
      },
      "else": {
        "$op": "concat",
        "parts": [
          {
            "$op": "arg",
            "name": "count"
          },
          " registros importados"
        ]
      }
    }
  },
  "settings.increaseCleanupRange": "Ampliar intervalo de eliminación",
  "settings.increaseMinute": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Aumentar ",
        {
          "$op": "arg",
          "name": "label"
        },
        " en un minuto"
      ]
    }
  },
  "settings.languageLabel": "Idioma",
  "settings.languageLoadFailed": "Idioma no disponible. Se mantiene el idioma actual.",
  "settings.languageOptions.enUS": "English",
  "settings.languageOptions.zhCN": "中文",
  "settings.launchAtLoginLabel": "Iniciar con Windows",
  "settings.loadFailed": "No se pudo cargar la configuración.",
  "settings.loading": "Cargando configuración...",
  "settings.minimizeToWidgetLabel": "Minimizar al widget",
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
        " min"
      ]
    }
  },
  "settings.remoteBackupTitle": "Configuración de WebDAV",
  "settings.remoteStatusBridgeMachineIdLabel": "ID del dispositivo",
  "settings.remoteStatusBridgeTitle": "Envío remoto",
  "settings.remoteStatusBridgeTokenLabel": "Token",
  "settings.remoteStatusBridgeUrlLabel": "URL de destino",
  "settings.residentTitle": "En segundo plano",
  "settings.restoreConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Método de restauración: ",
        {
          "$op": "arg",
          "name": "strategy"
        },
        "\nArchivo de destino: ",
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
  "settings.restoreConfirmTitle": "Restaurar copia de seguridad",
  "settings.restoreSourceLocalHint": "Elige un archivo ZIP local.",
  "settings.restoreSourceLocalTitle": "Restauración local",
  "settings.restoreSourceRemoteHint": "Elige una copia de seguridad en WebDAV.",
  "settings.restoreSourceRemoteTitle": "Restauración desde WebDAV",
  "settings.restoreSourceTitle": "Elegir origen de restauración",
  "settings.restoreStrategyHint": "Elige cómo se tratarán los datos actuales al restaurar.",
  "settings.restoreStrategyLabel": "Método de restauración",
  "settings.restoreStrategyOptionHints.merge": "Conservar datos actuales y eliminar duplicados",
  "settings.restoreStrategyOptionHints.replace": "Conservar solo los datos de la copia tras restaurar",
  "settings.restoreStrategyOptions.merge": "Combinar",
  "settings.restoreStrategyOptions.replace": "Reemplazar",
  "settings.retry": "Reintentar",
  "settings.save": "Guardar",
  "settings.saved": "Configuración actualizada",
  "settings.saveFailed": "No se pudo guardar la configuración. Inténtalo más tarde.",
  "settings.scheduledBackupCleanupWarning": "La última copia es válida, pero aún no se pudo eliminar la copia automática anterior. Patina lo reintentará más tarde.",
  "settings.scheduledBackupLabels": {
    "directory": "Guardar en",
    "frequency": "Frecuencia",
    "nextExecution": "Próxima ejecución",
    "recentFailure": "Último error",
    "recentSuccess": "Último éxito",
    "time": "Hora",
    "title": "Copia de seguridad programada"
  },
  "settings.saving": "Guardando...",
  "settings.servicesTitle": "Servicios",
  "settings.startMinimizedLabel": "Iniciar en segundo plano",
  "settings.storage.changePathAction": "Cambiar ubicación",
  "settings.storage.dataDirectoryLabel": "Datos",
  "settings.storage.installDirectoryLabel": "Instalación",
  "settings.storage.openDirectoryAction": "Abrir carpeta",
  "settings.storage.restartAndApplyAction": "Reiniciar y aplicar",
  "settings.storage.restoreDefaultPathAction": "Restaurar ubicación predeterminada",
  "settings.storage.storageCacheMigrationConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Caché actual: ",
        {
          "$op": "arg",
          "name": "currentWebviewRoot"
        },
        "\nCaché de destino: ",
        {
          "$op": "arg",
          "name": "targetWebviewRoot"
        },
        "\n\nPatina guardará el registro actual, se reiniciará y usará la carpeta de caché de destino. No muevas ni elimines esa carpeta hasta que termine."
      ]
    }
  },
  "settings.storage.storageCacheMigrationConfirmTitle": "Cambiar carpeta de caché",
  "settings.storage.storageDataMigrationConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Carpeta actual: ",
        {
          "$op": "arg",
          "name": "currentDataRoot"
        },
        "\nCarpeta de destino: ",
        {
          "$op": "arg",
          "name": "targetDataRoot"
        },
        "\n\nPatina guardará el registro actual, se reiniciará y migrará los datos a la carpeta de destino. No muevas ni elimines ninguna de las dos carpetas hasta que termine la migración."
      ]
    }
  },
  "settings.storage.storageDataMigrationConfirmTitle": "Cambiar carpeta de datos",
  "settings.storage.storageDirectoryTitle": "Rutas locales",
  "settings.storage.storageMigrationFailed": "No se pudo preparar el reinicio. Comprueba la carpeta de destino.",
  "settings.storage.storageOpenDirectoryFailed": "No se pudo abrir esa carpeta.",
  "settings.storage.storageRestoreDefaultCacheConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Caché actual: ",
        {
          "$op": "arg",
          "name": "currentWebviewRoot"
        },
        "\nCaché predeterminada: ",
        {
          "$op": "arg",
          "name": "defaultWebviewRoot"
        },
        "\n\nPatina guardará el registro actual, se reiniciará y restaurará la carpeta de caché predeterminada. No muevas ni elimines esa carpeta hasta que termine."
      ]
    }
  },
  "settings.storage.storageRestoreDefaultDataConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Datos actuales: ",
        {
          "$op": "arg",
          "name": "currentDataRoot"
        },
        "\nDatos predeterminados: ",
        {
          "$op": "arg",
          "name": "defaultDataRoot"
        },
        "\n\nPatina guardará el registro actual, se reiniciará y migrará los datos a la carpeta predeterminada. No muevas ni elimines ninguna de las dos carpetas hasta que termine la migración."
      ]
    }
  },
  "settings.storage.storageSnapshotRefreshAction": "Comprobar almacenamiento",
  "settings.storage.storageSnapshotRefreshFailed": "No se pudieron comprobar las carpetas de almacenamiento.",
  "settings.storage.webviewCacheClearConfirmDetail": "Patina guardará el registro actual, se reiniciará y borrará la caché regenerable de WebView antes de crear la ventana.",
  "settings.storage.webviewCacheClearConfirmTitle": "¿Reiniciar y borrar la caché?",
  "settings.storage.webviewCacheClearFailed": "No se pudo preparar la limpieza de caché. Inténtalo de nuevo.",
  "settings.storage.webviewCacheClearTitle": "Borrar caché",
  "settings.storage.webviewCacheDirectoryLabel": "Caché",
  "settings.themeLibraryOptions.dark": "Oscuro",
  "settings.themeLibraryOptions.light": "Claro",
  "settings.themeModeLabel": "Tema",
  "settings.themeModeOptions.dark": "Oscuro",
  "settings.themeModeOptions.light": "Claro",
  "settings.themeModeOptions.system": "Sistema",
  "settings.timelineMergeGapHint": "Detiene el registro tras la inactividad; los cambios breves de app mantienen la continuidad de la cronología.",
  "settings.timelineMergeGapLabel": "Tiempo de continuidad de actividad",
  "settings.title": "Configuración",
  "settings.tracking": "Registro",
  "settings.trackingPanelTitle": "Registro",
  "settings.trackingPausedLabel": "Pausar registro",
  "settings.unsaved": "Cambios sin guardar",
  "settings.webActivityAddressLabel": "Puerto",
  "settings.webActivityHelpAction": "Guía",
  "settings.webActivityHelpCopiedAction": "Copiado",
  "settings.webActivityHelpCopyPortAction": "Copiar puerto",
  "settings.webActivityHelpCopyTokenAction": "Copiar Token",
  "settings.webActivityHelpNote": "Cuando Patina Web Sync está activado y conectado:\n• Sincroniza automáticamente la dirección, el título y el icono del sitio web de la pestaña activa.\n• No lee el contenido de la página, valores de formularios, capturas de pantalla ni el portapapeles.\n• No examina ni importa el historial del navegador.\n• Las ventanas privadas no se guardan en los registros web.",
  "settings.webActivityHelpSteps": [
    {
      "title": "Preparar datos de conexión",
      "description": "La extensión usa el puerto y el Token de esta página para conectarse con Patina local.",
      "details": [
        "Copia el puerto y el Token para pegarlos en la configuración de la extensión."
      ]
    },
    {
      "title": "Instalar la extensión del navegador",
      "description": "Elige un navegador e instala Patina Web Sync desde su tienda.",
      "showStoreBadges": true,
      "details": [
        {
          "text": "Si la tienda no está disponible, instala manualmente desde las versiones de Patina Web Sync.",
          "links": [
            {
              "label": "Abrir versiones",
              "href": "https://github.com/Ceceliaee/patina-web-sync/releases/latest"
            }
          ]
        }
      ]
    },
    {
      "title": "Configurar la extensión",
      "description": "Abre la configuración de Patina Web Sync e introduce los datos de conexión que aparecen aquí.",
      "details": [
        "Abre el menú Extensiones en la barra de herramientas del navegador.",
        "Busca Patina Web Sync y ábrelo.",
        "Pulsa Configuración en la ventana emergente de la extensión.",
        "Pega el puerto y el Token que aparecen en esta página.",
        "También puedes acceder desde la gestión de extensiones: busca Patina Web Sync, pulsa Detalles y luego Opciones de la extensión."
      ]
    },
    {
      "title": "Sincronizar la página actual",
      "description": "Al abrir una página web normal, la extensión sincroniza la página activa.",
      "details": [
        "Abre una página web http/https.",
        "Espera a que Patina Web Sync sincronice automáticamente la página actual.",
        "Para sincronizar de inmediato, pulsa Sincronizar página actual en la ventana emergente de la extensión."
      ]
    }
  ],
  "settings.webActivityHelpTitle": "Guía de sincronización web",
  "settings.webActivityTitle": "Sincronización web",
  "settings.webActivityTokenLabel": "Token",
  "settings.webDavConfigTitle": "Configuración de WebDAV",
  "settings.webDavConfigure": "Configurar",
  "settings.webDavDeleteAction": "Eliminar",
  "settings.webDavDeleteDetail": "Solo se eliminan la configuración y la contraseña locales de WebDAV. Las copias remotas no se eliminan.",
  "settings.webDavDeleteTitle": "Eliminar configuración de WebDAV",
  "settings.webDavEdit": "Editar",
  "settings.webDavPassword": "Contraseña de aplicación",
  "settings.webDavRemoteBackupsDescription": "Elige una copia remota. Se descargará y se mostrará una vista previa de compatibilidad antes de confirmar la restauración.",
  "settings.webDavRemoteBackupsEmpty": "No hay copias remotas disponibles.",
  "settings.webDavRemoteBackupsTitle": "Copias remotas",
  "settings.webDavRestoreSelected": "Restaurar",
  "settings.webDavServerUrl": "Dirección del servidor",
  "settings.webDavTestConnection": "Probar conexión",
  "settings.webDavTesting": "Probando...",
  "settings.webDavUsername": "Nombre de usuario"
} as const;
