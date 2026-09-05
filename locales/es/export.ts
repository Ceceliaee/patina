// es locale resource. Pure data only.
export const MESSAGES = {
  "export.collapseFieldGroup": "Contraer",
  "export.configFields": "Configurar campos",
  "export.configFieldsCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "n"
        },
        " / ",
        {
          "$op": "arg",
          "name": "total"
        },
        " campos"
      ]
    }
  },
  "export.configFieldsEmpty": "Mantén al menos un campo de exportación",
  "export.configFieldsHint": "Selecciona los campos que quieres exportar.",
  "export.configFieldsTitle": "Configuración de campos de exportación",
  "export.deselectGroupFields": "Deseleccionar todo",
  "export.dialogDescription": "Elige el intervalo, el formato y los campos antes de exportar.",
  "export.expandFieldGroup": "Expandir",
  "export.exportAction": "Exportar",
  "export.exportDone": {
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
          "Exportado: ",
          {
            "$op": "arg",
            "name": "count"
          },
          " registro"
        ]
      },
      "else": {
        "$op": "concat",
        "parts": [
          "Exportados: ",
          {
            "$op": "arg",
            "name": "count"
          },
          " registros"
        ]
      }
    }
  },
  "export.exportFailed": "Error de exportación",
  "export.exporting": "Exportando...",
  "export.fields.app_name.desc": "Nombre de la aplicación, por ejemplo, Google Chrome",
  "export.fields.app_name.label": "Nombre de la aplicación",
  "export.fields.browser_client_id.desc": "ID del cliente de origen de sincronización web",
  "export.fields.browser_client_id.label": "ID del cliente del navegador",
  "export.fields.browser_exe_name.desc": "Nombre del ejecutable del proceso del navegador",
  "export.fields.browser_exe_name.label": "Ejecutable del navegador",
  "export.fields.browser_kind.desc": "Familia del navegador, como chrome/firefox",
  "export.fields.browser_kind.label": "Tipo de navegador",
  "export.fields.category_color.desc": "Valor de color de la categoría actual",
  "export.fields.category_color.label": "Color de categoría",
  "export.fields.category_id.desc": "ID estable de la categoría actual para combinar datos",
  "export.fields.category_id.label": "ID de categoría",
  "export.fields.category.desc": "Nombre de categoría según las reglas actuales de aplicación o dominio",
  "export.fields.category.label": "Categoría",
  "export.fields.continuity_group_start_time.desc": "Hora de inicio del grupo de continuidad de sesiones",
  "export.fields.continuity_group_start_time.label": "Inicio del grupo de continuidad",
  "export.fields.created_at.desc": "Fecha de creación del registro de actividad web",
  "export.fields.created_at.label": "Fecha de creación",
  "export.fields.domain.desc": "Dominio del sitio web, por ejemplo, www.google.com",
  "export.fields.domain.label": "Dominio",
  "export.fields.duration_minutes.desc": "Duración en minutos para el análisis, con tres decimales.",
  "export.fields.duration_minutes.label": "Duración (minutos)",
  "export.fields.duration_ms.desc": "Duración del registro en milisegundos",
  "export.fields.duration_ms.label": "Duración (ms)",
  "export.fields.end_time.desc": "Hora final del registro (YYYY-MM-DD HH:mm:ss)",
  "export.fields.end_time.label": "Hora final",
  "export.fields.exe_name.desc": "Nombre del archivo ejecutable del proceso, por ejemplo, chrome.exe",
  "export.fields.exe_name.label": "Nombre del ejecutable",
  "export.fields.favicon_url.desc": "URL del icono guardada con el registro de actividad web",
  "export.fields.favicon_url.label": "URL del icono del sitio",
  "export.fields.local_date.desc": "Fecha local obtenida de la hora de inicio",
  "export.fields.local_date.label": "Fecha local",
  "export.fields.local_month.desc": "YYYY-MM obtenido de la hora de inicio",
  "export.fields.local_month.label": "Mes local",
  "export.fields.local_week.desc": "Semana ISO local obtenida de la hora de inicio",
  "export.fields.local_week.label": "Semana local",
  "export.fields.normalized_domain.desc": "Dominio sin el prefijo www",
  "export.fields.normalized_domain.label": "Dominio normalizado",
  "export.fields.page_title.desc": "Título HTML de la página",
  "export.fields.page_title.label": "Título de la página",
  "export.fields.record_type.desc": "session (aplicación local) o web (navegación)",
  "export.fields.record_type.label": "Tipo de registro",
  "export.fields.session_id.desc": "ID de fila de la sesión de aplicación local",
  "export.fields.session_id.label": "ID de sesión",
  "export.fields.source_key.desc": "Ejecutable para aplicaciones, dominio normalizado para web",
  "export.fields.source_key.label": "Clave de origen",
  "export.fields.source_name.desc": "Nombre de la aplicación o del dominio web",
  "export.fields.source_name.label": "Nombre del origen",
  "export.fields.start_hour.desc": "Hora de inicio, 0–23",
  "export.fields.start_hour.label": "Hora de inicio",
  "export.fields.start_time.desc": "Hora de inicio del registro (YYYY-MM-DD HH:mm:ss)",
  "export.fields.start_time.label": "Fecha y hora de inicio",
  "export.fields.updated_at.desc": "Fecha de actualización del registro de actividad web",
  "export.fields.updated_at.label": "Fecha de actualización",
  "export.fields.url.desc": "URL completa de la página",
  "export.fields.url.label": "URL",
  "export.fields.web_segment_id.desc": "ID de fila del segmento de actividad web",
  "export.fields.web_segment_id.label": "ID de segmento web",
  "export.fields.web_source.desc": "Origen que escribió el registro de actividad web",
  "export.fields.web_source.label": "Origen web",
  "export.fields.weekday.desc": "Número del día de la semana: 1 es lunes y 7 es domingo",
  "export.fields.weekday.label": "Día de la semana",
  "export.fields.window_title.desc": "Texto del título de la ventana activa",
  "export.fields.window_title.label": "Título de la ventana",
  "export.formatCSV": "CSV",
  "export.formatCSVHint": "Adecuado para Excel y hojas de cálculo en general.",
  "export.formatLabel": "Formato",
  "export.formatMarkdown": "Markdown",
  "export.formatMarkdownHint": "Adecuado para leer, editar y organizar notas.",
  "export.formatParquet": "Parquet",
  "export.formatParquetHint": "Adecuado para herramientas de análisis y procesamiento por columnas.",
  "export.formatSQLite": "SQLite",
  "export.formatSQLiteHint": "Adecuado para consultas SQL locales y archivos completos.",
  "export.groupActivity": "Datos básicos de actividad",
  "export.groupActivityHint": "Campos comunes de tipo de registro, fecha y duración.",
  "export.groupAnalysis": "Análisis temporal",
  "export.groupAnalysisHint": "Campos para análisis semanal y mensual.",
  "export.groupApps": "Información de aplicaciones",
  "export.groupAppsHint": "Campos de sesiones de aplicaciones locales.",
  "export.groupAudit": "Origen y auditoría",
  "export.groupAuditHint": "Identidad del origen y fechas de escritura de registros.",
  "export.groupClassification": "Clasificación",
  "export.groupClassificationHint": "Nombre, identidad y color de la categoría actual.",
  "export.groupWeb": "Información web",
  "export.groupWebHint": "Campos de los registros de actividad del navegador.",
  "export.nextPickerMode": "Siguiente modo de intervalo",
  "export.nextRange": "Intervalo siguiente",
  "export.openRangePicker": "Abrir selector de intervalo",
  "export.previousPickerMode": "Modo de intervalo anterior",
  "export.previousRange": "Intervalo anterior",
  "export.restoreFormatDefaults": "Restaurar valores predeterminados de este formato",
  "export.selectGroupFields": "Seleccionar todo",
  "export.scheduledErrors": {
    "databaseUnavailable": "Los datos de actividad no están disponibles temporalmente; Patina lo reintentará",
    "diskFull": "No queda espacio en el destino de exportación",
    "generic": "No se pudo completar la exportación programada",
    "interrupted": "La exportación se interrumpió; Patina lo reintentará",
    "permissionDenied": "Patina no puede escribir en el destino de exportación",
    "publishFailed": "No se pudo guardar la exportación validada en el destino",
    "targetConflict": "Ya existe otro archivo con el nombre de este período",
    "targetMissing": "El destino de exportación no está disponible",
    "validation": "La exportación generada no superó la validación"
  },
  "export.scheduledTitle": "Exportación programada",
  "export.subtitle": "Exporta sesiones y actividad web para hojas de cálculo, archivos o análisis.",
  "export.timeRangeInvalid": "La fecha final no puede ser anterior a la inicial",
  "export.timeRangeLabel": "Intervalo de tiempo",
  "export.timeRangeMissing": "Selecciona una fecha inicial y una fecha final",
  "export.timeRangeModeDay": "Hoy",
  "export.timeRangeModeMonth": "Este mes",
  "export.timeRangeModeWeek": "Esta semana",
  "export.timeRangeModeYear": "Este año",
  "export.title": "Exportación de datos",
  "export.toggleField": "Activar o desactivar la exportación del campo"
} as const;
