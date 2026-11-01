// es locale resource. Pure data only.
export const MESSAGES = {
  "tools.reminderTimeLabel": "Recordar a las",
  "tools.reminderRepeatLabel": "Repetir",
  "tools.reminderRepeatNone": "Nunca",
  "tools.reminderRepeatInterval": "Por intervalo",
  "tools.reminderRepeatDaily": "Cada día",
  "tools.reminderRepeatWeekly": "Cada semana",
  "tools.reminderRepeatMonthly": "Cada mes",
  "tools.reminderRepeatYearly": "Cada año",
  "tools.reminderIntervalLabel": "Intervalo",
  "tools.reminderMinutesUnit": "Minutos",
  "tools.reminderHoursUnit": "Horas",
  "tools.reminderRepeatInvalid": "Selecciona al menos un día de la semana.",

  "tools.reminderSnooze": "Recordar más tarde",
  "tools.reminderConfirmComplete": "Marcar como completado",
  "tools.reminderCompleted": "Completado",
  "tools.reminderPendingConfirmation": "Pendiente de confirmación",
  "tools.reminderSnoozeDelay": {"$type": "message", "body": {"$op": "concat", "parts": ["Dentro de ", {"$op": "arg", "name": "value"}]}},
  "tools.reminderOccurredAt": {"$type": "message", "body": {"$op": "concat", "parts": ["Hora del recordatorio: ", {"$op": "arg", "name": "value"}]}},
  "tools.reminderEditTitle": "Editar recordatorio",
  "tools.usageLimitReached": "Se agotó el tiempo disponible de hoy",
  "tools.usageExtend": "Ampliar tiempo",
  "tools.usageReturnDesktop": "Volver al escritorio",
  "tools.usageExtendFifteen": "Usar 15 minutos más",
  "tools.usageExtendHour": "Usar 1 hora más",
  "tools.usageExtendToday": "Sin límite por hoy",
  "tools.usageExtensionDuration": "Tiempo adicional de uso",
  "tools.usageExtendTitle": {"$type": "message", "body": {"$op": "concat", "parts": ["Ampliar tiempo de «", {"$op": "arg", "name": "value"}, "»"]}},
  "tools.usageLimitSummary": {"$type": "message", "body": {"$op": "concat", "parts": ["Has usado ", {"$op": "arg", "name": "value"}, ". Se alcanzó el límite de uso."]}},
  "tools.absoluteDateLabel": "Fecha",
  "tools.absoluteTimeLabel": "Hora",
  "tools.actionFailed": "La acción falló. Inténtalo más tarde.",
  "tools.activityReminderCandidatesLoadFailed": "Destinos no disponibles.",
  "tools.activityReminderDisable": "Desactivar",
  "tools.activityReminderEdit": "Editar",
  "tools.activityReminderDelete": "Eliminar",
  "tools.activityReminderEditTitle": "Editar límite de uso",
  "tools.activityReminderEmpty": "Sin reglas",
  "tools.activityReminderRulesTitle": "Reglas",
  "tools.activityReminderSuspension.source_disabled": "Origen desactivado",
  "tools.activityReminderSuspension.target_deleted": "Destino eliminado",
  "tools.activityReminderSuspension.target_excluded": "Excluido",
  "tools.activityReminderTargetLabel": "Destino",
  "tools.activityReminderTargetPlaceholder": "Elige una app, categoría o sitio web",
  "tools.activityReminderTargetRequired": "Selecciona un destino.",
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
  "tools.reminderEmpty": "No hay recordatorios",
  "tools.reminderLabel": "Recordatorio",
  "tools.reminderLabelPlaceholder": "Ejemplo: tomar un descanso",
  "tools.reminderModeAbsolute": "Hora exacta",
  "tools.reminderModeEvent": "Recordatorios programados",
  "tools.reminderModeUsage": "Límites de uso",
  "tools.reminderModeApp": "App",
  "tools.reminderModeCategory": "Categoría",
  "tools.reminderModeRelative": "Tiempo relativo",
  "tools.reminderModeWeb": "Web",
  "tools.remindersTitle": "Recordatorio",
  "tools.reminderTimeInvalid": "La hora del recordatorio debe ser futura.",
  "tools.reset": "Restablecer",
  "tools.resume": "Reanudar",
  "tools.settingsEmpty": "No hay opciones configurables.",
  "tools.settingsTitle": "Configuración de herramientas",
  "tools.shortBreakDuration": "Descanso corto",
  "tools.skipPhase": "Omitir",
  "tools.activityReminderActive": "Activo",
  "tools.activityReminderDurationInvalid": "Usa entre 1 y 1440 min.",
  "tools.activityReminderDurationLabel": "Límite diario (min)",
  "tools.start": "Iniciar",
  "tools.stateRefreshPending": "Se está recuperando el estado. No repitas la acción.",
  "tools.statusChip.break": "Descanso",
  "tools.statusChip.countdown": "Cuenta atrás",
  "tools.statusChip.focus": "Concentración",
  "tools.statusChip.reminder": "Recordatorio",
  "tools.statusChip.stopwatch": "Temporizador",
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
