// es locale resource. Pure data only.
export const MESSAGES = {
  "tools.freeRestMode": "Modo de descanso",
  "tools.freeRestFixed": "Duración fija",
  "tools.freeRestRatio": "Proporcional",
  "tools.freeRestDuration": "Duración del descanso",
  "tools.freeRestProportion": "Proporción de concentración y descanso",
  "tools.freeFocusEmpty": "No hay sesiones",
  "tools.freeFocusEdit": "Editar sesión",
  "tools.freeFocusFinish": "Terminar la sesión",
  "tools.freeFocusRestart": "Iniciar la siguiente sesión",
  "tools.freeFocusRest": "Descanso",
  "tools.freeFocusStart": "Iniciar concentración",
  "tools.freeFocusPause": "Pausar concentración",
  "tools.freeFocusResume": "Reanudar concentración",
  "tools.freeFocusReset": "Reiniciar concentración",

  "tools.pomodoroStartLater": "Empezar después",
  "tools.pomodoroStartBreak": "Iniciar descanso",
  "tools.pomodoroStartFocus": "Iniciar concentración",
  "tools.pomodoroStartNextGroup": "Iniciar otro ciclo",
  "tools.pomodoroNextPhase": {"$type": "message", "body": {"$op": "concat", "parts": ["Siguiente: ", {"$op": "arg", "name": "phase"}, " · ", {"$op": "arg", "name": "duration"}]}},
  "tools.pomodoroGroupSummary": {"$type": "message", "body": {"$op": "concat", "parts": ["Pomodoros: ", {"$op": "arg", "name": "rounds"}, " · Ciclos completados: ", {"$op": "arg", "name": "groups"}]}},
  "tools.pomodoroCompletedGroups": {"$type": "message", "body": {"$op": "concat", "parts": ["Ciclos completados: ", {"$op": "arg", "name": "count"}, ""]}},

  "tools.pomodoroTimingSettings": "Configuración del temporizador",
  "tools.pomodoroTimingSummary": {"$type": "message", "body": {"$op": "concat", "parts": ["", {"$op": "arg", "name": "minutes"}, " min de concentración · ", {"$op": "arg", "name": "rounds"}, " ciclos"]}},

  "tools.pomodoroTaskCreate": "Nueva sesión de concentración",
  "tools.pomodoroTaskEdit": "Editar tarea Pomodoro",
  "tools.pomodoroTaskName": "Nombre",
  "tools.pomodoroTaskPlaceholder": "Por ejemplo: leer artículos",
  "tools.pomodoroTaskEmpty": "No hay tareas Pomodoro",
  "tools.pomodoroTaskDefault": "Tarea Pomodoro",
  "tools.pomodoroRoundUnit": "rondas",
  "tools.reminderTimeLabel": "Recordar a las",
  "tools.reminderRepeatLabel": "Repetir",
  "tools.reminderRepeatNone": "Nunca",
  "tools.reminderRepeatInterval": "Por intervalo",
  "tools.reminderRepeatDaily": "Cada día",
  "tools.reminderRepeatWeekly": "Cada semana",
  "tools.reminderRepeatMonthly": "Cada mes",
  "tools.reminderRepeatYearly": "Cada año",
  "tools.reminderMinutesUnit": "Minutos",

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
  "tools.actionFailed": "La acción falló. Inténtalo más tarde.",
  "tools.activityReminderCandidatesLoadFailed": "Destinos no disponibles.",
  "tools.activityReminderDisable": "Desactivar",
  "tools.activityReminderEdit": "Editar",
  "tools.activityReminderDelete": "Eliminar",
  "tools.activityReminderEditTitle": "Editar límite de uso",
  "tools.activityReminderEmpty": "Sin reglas",
  "tools.activityReminderSuspension.source_disabled": "Origen desactivado",
  "tools.activityReminderSuspension.target_deleted": "Destino eliminado",
  "tools.activityReminderSuspension.target_excluded": "Excluido",
  "tools.activityReminderTargetLabel": "Destino",
  "tools.activityReminderTargetPlaceholder": "Elige una app, categoría o sitio web",
  "tools.activityReminderTargetRequired": "Selecciona un destino.",
  "tools.alertDismiss": "Entendido",
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
  "tools.createReminder": "Crear",
  "tools.defaultReminderLabel": "Se acabó el tiempo",
  "tools.focusDuration": "Duración de concentración",
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
  "tools.pause": "Pausar",
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
  "tools.pomodoroStatus.completed": "Completado",
  "tools.pomodoroStatus.idle": "Sin iniciar",
  "tools.pomodoroStatus.paused": "En pausa",
  "tools.pomodoroStatus.running": "En marcha",
  "tools.pomodoroTitle": "Concentración",
  "tools.focusModePomodoro": "Pomodoro",
  "tools.focusModeFree": "Concentración libre",
  "tools.reminderEmpty": "No hay recordatorios",
  "tools.reminderLabel": "Recordatorio",
  "tools.reminderLabelPlaceholder": "Ejemplo: tomar un descanso",
  "tools.reminderModeEvent": "Recordatorios programados",
  "tools.reminderModeUsage": "Límites de uso",
  "tools.reminderModeApp": "App",
  "tools.reminderModeCategory": "Categoría",
  "tools.reminderModeWeb": "Web",
  "tools.remindersTitle": "Recordatorio",
  "tools.reminderTimeInvalid": "La hora del recordatorio debe ser futura.",
  "tools.reset": "Restablecer",
  "tools.resume": "Reanudar",
  "tools.settingsEmpty": "No hay opciones configurables.",
  "tools.settingsTitle": "Configuración de herramientas",
  "tools.shortBreakDuration": "Descanso corto",
  "tools.activityReminderActive": "Activo",
  "tools.activityReminderDurationLabel": "Límite diario",
  "tools.start": "Iniciar",
  "tools.stateRefreshPending": "Se está recuperando el estado. No repitas la acción.",
  "tools.statusChip.break": "Descanso",
  "tools.statusChip.focus": "Concentración",
  "tools.statusChip.reminder": "Recordatorio",
  "tools.title": "Herramientas"
} as const;
