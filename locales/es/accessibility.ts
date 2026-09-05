// es locale resource. Pure data only.
export const MESSAGES = {
  "accessibility.color.blueChannel": "Canal azul",
  "accessibility.color.color": "Color",
  "accessibility.color.colorFormat": "Formato de color",
  "accessibility.color.colorPicker": "Selector de color",
  "accessibility.color.eyedropper": "Cuentagotas",
  "accessibility.color.eyedropperUnsupported": "El cuentagotas no está disponible",
  "accessibility.color.greenChannel": "Canal verde",
  "accessibility.color.hexValue": "Valor hexadecimal del color",
  "accessibility.color.hueChannel": "Tono",
  "accessibility.color.hueSlider": "Control de tono",
  "accessibility.color.lightnessChannel": "Luminosidad",
  "accessibility.color.redChannel": "Canal rojo",
  "accessibility.color.saturationChannel": "Saturación",
  "accessibility.data.appTrendRange": "Seleccionar intervalo de tendencia de aplicaciones",
  "accessibility.data.categoryTrendRange": "Seleccionar intervalo de tendencia de categorías",
  "accessibility.data.earlierRange": "Ir al intervalo anterior",
  "accessibility.data.heatmapCell": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        ", ",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "accessibility.data.heatmapRange": "Seleccionar intervalo del mapa de calor",
  "accessibility.data.longerAppTrendRange": "Ampliar intervalo de tendencia de aplicaciones",
  "accessibility.data.longerTrendRange": "Ampliar intervalo de tendencia",
  "accessibility.data.newerRange": "Ir al intervalo siguiente",
  "accessibility.data.nextPickerMode": "Siguiente modo de intervalo",
  "accessibility.data.nextPickerMonth": "Mes siguiente",
  "accessibility.data.openTrendRangePicker": "Abrir selector de intervalo de tendencia",
  "accessibility.data.previousPickerMode": "Modo de intervalo anterior",
  "accessibility.data.previousPickerMonth": "Mes anterior",
  "accessibility.data.resetTrendRange": "Restablecer a los últimos 7 días",
  "accessibility.data.shorterAppTrendRange": "Reducir intervalo de tendencia de aplicaciones",
  "accessibility.data.shorterTrendRange": "Reducir intervalo de tendencia",
  "accessibility.data.trendRange": "Seleccionar intervalo de tendencia",
  "accessibility.data.trendSummary": "Resumen de tendencia",
  "accessibility.data.webTrendRange": "Seleccionar intervalo de tendencia web",
  "accessibility.date.nextMonth": "Mes siguiente",
  "accessibility.date.previousMonth": "Mes anterior",
  "accessibility.history.decreaseMinDuration": "Reducir un minuto la duración mostrada",
  "accessibility.history.increaseMinDuration": "Aumentar un minuto la duración mostrada",
  "accessibility.history.nextDay": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Ir al día siguiente: ",
        {
          "$op": "arg",
          "name": "dateLabel"
        },
        ""
      ]
    }
  },
  "accessibility.history.nextMonth": "Mes siguiente",
  "accessibility.history.previousDay": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Ir al día anterior: ",
        {
          "$op": "arg",
          "name": "dateLabel"
        },
        ""
      ]
    }
  },
  "accessibility.history.previousMonth": "Mes anterior",
  "accessibility.history.toggleActivityDetails": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "if",
          "when": {
            "$op": "arg",
            "name": "expanded"
          },
          "then": "Contraer",
          "else": "Expandir"
        },
        " detalles de títulos de ",
        {
          "$op": "arg",
          "name": "appName"
        },
        ""
      ]
    }
  },
  "accessibility.sidebar.navigationLabels": "Etiquetas de navegación",
  "accessibility.settings.colorScheme": "Paleta de colores",
  "accessibility.settings.copyWebActivityPort": "Copiar puerto de sincronización web",
  "accessibility.settings.copyWebActivityToken": "Copiar Token de sincronización web",
  "accessibility.settings.generateServiceToken": "Generar Token",
  "accessibility.settings.hideRemoteMachineId": "Ocultar ID del dispositivo",
  "accessibility.settings.hideServiceToken": "Ocultar Token",
  "accessibility.settings.openWebActivityHelp": "Abrir guía de sincronización web",
  "accessibility.settings.showRemoteMachineId": "Mostrar ID del dispositivo",
  "accessibility.settings.showServiceToken": "Mostrar Token",
  "accessibility.settings.toggleBackgroundOptimization": "Activar o desactivar el ahorro de memoria en segundo plano",
  "accessibility.settings.toggleCloseToTray": "Activar o desactivar cerrar a la bandeja",
  "accessibility.settings.toggleGlobalTitle": "Activar o desactivar el registro global de títulos",
  "accessibility.settings.toggleLaunchAtLogin": "Activar o desactivar el inicio de la aplicación con Windows",
  "accessibility.settings.toggleMinimizeToWidget": "Activar o desactivar minimizar al widget",
  "accessibility.settings.toggleRemoteStatusBridge": "Activar o desactivar el envío remoto",
  "accessibility.settings.toggleStartMinimized": "Activar o desactivar el inicio en segundo plano",
  "accessibility.settings.toggleTrackingPaused": "Pausar o reanudar el registro",
  "accessibility.settings.toggleWebActivity": "Activar o desactivar la sincronización web",
  "accessibility.titleBar.close": "Cerrar ventana",
  "accessibility.titleBar.maximize": "Maximizar ventana",
  "accessibility.titleBar.minimize": "Minimizar ventana",
  "accessibility.titleBar.restore": "Restaurar ventana",
  "accessibility.tools.addTimerLap": "Añadir vuelta",
  "accessibility.tools.cancelReminder": "Cancelar recordatorio",
  "accessibility.tools.createReminder": "Crear recordatorio",
  "accessibility.tools.decreaseDuration": {
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
  "accessibility.tools.increaseDuration": {
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
  "accessibility.tools.openStatusChip": "Abrir estado de la herramienta",
  "accessibility.tools.pausePomodoro": "Pausar pomodoro",
  "accessibility.tools.pauseTimer": "Pausar temporización",
  "accessibility.tools.resetPomodoro": "Restablecer pomodoro",
  "accessibility.tools.resetTimer": "Restablecer temporización",
  "accessibility.tools.restorePomodoroDefaults": "Restaurar duraciones predeterminadas del pomodoro",
  "accessibility.tools.resumePomodoro": "Reanudar pomodoro",
  "accessibility.tools.resumeTimer": "Reanudar temporización",
  "accessibility.tools.skipPomodoroPhase": "Omitir fase del pomodoro",
  "accessibility.tools.startPomodoro": "Iniciar pomodoro",
  "accessibility.tools.startTimer": "Iniciar temporización",
  "accessibility.widget.collapse": "Contraer widget",
  "accessibility.widget.currentApp": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Aplicación actual: ",
        {
          "$op": "arg",
          "name": "appName"
        },
        ""
      ]
    }
  },
  "accessibility.widget.expand": "Expandir widget",
  "accessibility.widget.openMainWindow": "Abrir ventana principal",
  "accessibility.widget.pin": "Mantener widget expandido",
  "accessibility.widget.toggle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "if",
          "when": {
            "$op": "arg",
            "name": "expanded"
          },
          "then": "Contraer widget",
          "else": "Expandir widget"
        },
        ", ",
        {
          "$op": "arg",
          "name": "statusTitle"
        },
        ""
      ]
    }
  }
} as const;
