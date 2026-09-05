// es locale resource. Pure data only.
export const MESSAGES = {
  "tools.absoluteDateLabel": "Fecha",
  "tools.absoluteTimeLabel": "Hora",
  "tools.actionFailed": "La acción falló. Inténtalo más tarde.",
  "tools.activityReminderAppPlaceholder": "Seleccionar aplicación",
  "tools.activityReminderCandidatesLoadFailed": "Destinos no disponibles.",
  "tools.activityReminderCategoryPlaceholder": "Seleccionar categoría",
  "tools.activityReminderDisable": "Desactivar",
  "tools.activityReminderEmpty": "Sin reglas",
  "tools.activityReminderRulesTitle": "Reglas",
  "tools.activityReminderSuspension.source_disabled": "Origen desactivado",
  "tools.activityReminderSuspension.target_deleted": "Destino eliminado",
  "tools.activityReminderSuspension.target_excluded": "Excluido",
  "tools.activityReminderTargetLabel": "Destino",
  "tools.activityReminderTargetRequired": "Selecciona un destino.",
  "tools.activityReminderWebPlaceholder": "Seleccionar sitio web",
  "tools.alertDismiss": "Entendido",
  "tools.alertOccurredAt": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Vence a las ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "tools.alertPausePomodoro": "Pausar",
  "tools.alertPausingPomodoro": "Pausando...",
  "tools.beta": "Beta",
  "tools.completedToday": {
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
          " completado hoy"
        ]
      },
      "else": {
        "$op": "concat",
        "parts": [
          {
            "$op": "arg",
            "name": "count"
          },
          " completados hoy"
        ]
      }
    }
  },
  "tools.countdownDuration": "Duración de la cuenta atrás",
  "tools.createReminder": "Crear",
  "tools.defaultReminderLabel": "Se acabó el tiempo",
  "tools.dueNow": "Ahora",
  "tools.durationPresets": {
    "5": "5 min",
    "10": "10 min",
    "25": "25 min",
    "30": "30 min",
    "60": "60 min"
  },
  "tools.focusDuration": "Duración de concentración",
  "tools.lap": "Vuelta",
  "tools.lapIndex": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Vuelta ",
        {
          "$op": "arg",
          "name": "index"
        },
        ""
      ]
    }
  },
  "tools.lapsEmpty": "Sin vueltas",
  "tools.lapsTitle": "Vueltas",
  "tools.loadFailed": "No se pudo cargar el estado de las herramientas.",
  "tools.longBreakDuration": "Descanso largo",
  "tools.longBreakEvery": "Intervalo de descanso largo",
  "tools.longBreakEveryValue": {
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
          "Cada ",
          {
            "$op": "arg",
            "name": "count"
          },
          " pomodoro"
        ]
      },
      "else": {
        "$op": "concat",
        "parts": [
          "Cada ",
          {
            "$op": "arg",
            "name": "count"
          },
          " pomodoros"
        ]
      }
    }
  },
  "tools.minuteValue": {
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
  "tools.newReminder": "Nuevo recordatorio",
  "tools.notificationStatus": "Avisos al finalizar",
  "tools.pause": "Pausar",
  "tools.pendingReminders": "Lista de recordatorios",
  "tools.pomodoroCycle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "index"
        },
        " / ",
        {
          "$op": "arg",
          "name": "every"
        },
        " pomodoro"
      ]
    }
  },
  "tools.pomodoroPhase.focus": "Concentración",
  "tools.pomodoroPhase.longBreak": "Descanso largo",
  "tools.pomodoroPhase.shortBreak": "Descanso corto",
  "tools.pomodoroSettings": "Duraciones predeterminadas",
  "tools.pomodoroStatus.completed": "Completado",
  "tools.pomodoroStatus.idle": "Sin iniciar",
  "tools.pomodoroStatus.paused": "En pausa",
  "tools.pomodoroStatus.running": "En marcha",
  "tools.pomodoroTitle": "Pomodoro",
  "tools.relativeMinutesLabel": "Minutos a partir de ahora",
  "tools.reminderEmpty": "No hay recordatorios pendientes",
  "tools.reminderLabel": "Recordatorio",
  "tools.reminderLabelPlaceholder": "Ejemplo: tomar un descanso",
  "tools.reminderModeAbsolute": "Hora exacta",
  "tools.reminderModeEvent": "Evento",
  "tools.reminderModeApp": "Aplicación",
  "tools.reminderModeCategory": "Categoría",
  "tools.reminderModeRelative": "Tiempo relativo",
  "tools.reminderModeWeb": "Web",
  "tools.reminderStatus.cancelled": "Cancelado",
  "tools.reminderStatus.fired": "Activado",
  "tools.reminderStatus.scheduled": "Programado",
  "tools.remindersTitle": "Recordatorio",
  "tools.reminderTimeInvalid": "La hora del recordatorio debe ser futura.",
  "tools.reset": "Restablecer",
  "tools.resume": "Reanudar",
  "tools.retry": "Reintentar",
  "tools.settingsEmpty": "No hay opciones configurables.",
  "tools.settingsTitle": "Configuración de herramientas",
  "tools.shortBreakDuration": "Descanso corto",
  "tools.skipPhase": "Omitir",
  "tools.activityReminderActive": "Activo",
  "tools.activityReminderDailyLimit": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " min al día"
      ]
    }
  },
  "tools.activityReminderDurationInvalid": "Usa entre 1 y 1440 min.",
  "tools.activityReminderDurationLabel": "Límite diario (min)",
  "tools.activityReminderMessageLabel": "Mensaje",
  "tools.activityReminderMessagePlaceholder": "Ejemplo: tomar un descanso",
  "tools.start": "Iniciar",
  "tools.statusChip.break": "Descanso",
  "tools.statusChip.countdown": "Cuenta atrás",
  "tools.statusChip.focus": "Concentración",
  "tools.statusChip.reminder": "Recordatorio",
  "tools.statusChip.stopwatch": "Temporizador",
  "tools.subtitle": "Inicia herramientas locales de escritorio",
  "tools.timerHint": "Los resultados del temporizador no se guardan en los registros de actividad.",
  "tools.timerLabel": "Nombre",
  "tools.timerLabelPlaceholder": "Opcional",
  "tools.timerModeCountdown": "Cuenta atrás",
  "tools.timerModeStopwatch": "Cronómetro",
  "tools.timerStatus.completed": "Completado",
  "tools.timerStatus.idle": "Sin iniciar",
  "tools.timerStatus.paused": "En pausa",
  "tools.timerStatus.running": "En marcha",
  "tools.timerTitle": "Temporizador",
  "tools.title": "Herramientas"
} as const;
