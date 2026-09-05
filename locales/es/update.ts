// es locale resource. Pure data only.
export const MESSAGES = {
  "update.appUpdate": "Actualizaciones de la aplicación",
  "update.checkAgain": "Comprobar de nuevo",
  "update.checkErrorDetail": "No se pudo acceder al manifiesto de actualización. Puede que tu red no permita acceder a GitHub. Inténtalo más tarde o descarga manualmente.",
  "update.checkFailed": "No se pudieron comprobar las actualizaciones",
  "update.checkFailedDialog": "No se pudieron comprobar las actualizaciones",
  "update.checking": "Comprobando...",
  "update.checkingUpdates": "Buscando actualizaciones...",
  "update.checkUpdates": "Buscar actualizaciones",
  "update.dialogAvailable": "Nueva versión disponible",
  "update.dialogAvailableDetail": "Hay una nueva versión. Descárgala primero y después confirma la instalación.",
  "update.dialogDownloaded": "Actualización descargada",
  "update.dialogDownloadedDetail": "El paquete de actualización está listo. Confirma para reiniciar y completar la instalación.",
  "update.dialogDownloading": "Descargando actualización",
  "update.dialogDownloadingDetail": "Se está descargando el paquete. Al terminar, aparecerá la confirmación de instalación.",
  "update.dialogInstalling": "Instalando actualización",
  "update.dialogInstallingDetail": "La instalación ha comenzado. Mantén la aplicación abierta; se reiniciará al terminar.",
  "update.downloadedBytes": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Descargado: ",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "update.downloadedDetail": "El paquete está descargado. Confirma para reiniciar e instalar.",
  "update.downloadedTitle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Actualización descargada: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.downloadErrorDetail": "Se encontró una nueva versión, pero la descarga automática falló. Puedes descargarla manualmente.",
  "update.downloadFailed": "No se pudo descargar el instalador",
  "update.downloadFailedDialog": "Error de descarga",
  "update.downloading": "Descargando actualización...",
  "update.downloadInstaller": "Descargar instalador",
  "update.downloadNow": "Descargar ahora",
  "update.errorDetailWithSummary": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "prefix"
        },
        " Detalles: ",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "update.feedback": "Comentarios",
  "update.foundVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Nueva versión: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.genericErrorDetail": "No se pudo completar la actualización. Inténtalo más tarde.",
  "update.installAgain": "Instalar de nuevo",
  "update.installErrorDetail": "El paquete se descargó, pero la instalación no terminó. Reintenta la instalación o vuelve a descargarlo.",
  "update.installFailed": "La instalación de la actualización falló",
  "update.installFailedDialog": "Error de instalación",
  "update.installing": "Instalando actualización...",
  "update.installingProgress": "Instalando actualización. La aplicación se reiniciará pronto.",
  "update.installRestartDetail": "La aplicación se reiniciará después de la instalación.",
  "update.later": "Más tarde",
  "update.manualDownload": "Descarga manual",
  "update.notChecked": "Sin comprobar",
  "update.packageDownloaded": {
    "$type": "message",
    "body": {
      "$op": "if",
      "when": {
        "$op": "notEq",
        "left": {
          "$op": "coalesce",
          "left": {
            "$op": "arg",
            "name": "value"
          },
          "right": ""
        },
        "right": ""
      },
      "then": {
        "$op": "concat",
        "parts": [
          "Paquete ",
          {
            "$op": "arg",
            "name": "value"
          },
          " descargado"
        ]
      },
      "else": "Paquete descargado"
    }
  },
  "update.preparingPackage": "Preparando el paquete de actualización.",
  "update.processing": "Procesando...",
  "update.progressPending": "Obteniendo progreso",
  "update.redownloadInstaller": "Descargar de nuevo",
  "update.releaseNotes": "Notas de la versión",
  "update.restartInstall": "Reiniciar para instalar",
  "update.sidebarEntry": "Actualizar",
  "update.support": "Apoyar",
  "update.targetVersion": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Nueva versión: ",
        {
          "$op": "arg",
          "name": "version"
        },
        ""
      ]
    }
  },
  "update.unknownVersion": "versión desconocida",
  "update.updateFailed": "La actualización falló",
  "update.updateFailedDialog": "La actualización falló",
  "update.updateProcessFailed": "No se pudo completar la actualización.",
  "update.updateReadyDetail": "Hay una nueva versión disponible. Confirma para iniciar la descarga.",
  "update.upToDate": "Tienes la última versión"
} as const;
