// es locale resource. Pure data only.
export const MESSAGES = {
  "toast.backupExportFailed": "No se pudo crear la copia. Comprueba la ubicación de destino e inténtalo de nuevo.",
  "toast.backupExportSuccess": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Copia creada: ",
        {
          "$op": "arg",
          "name": "path"
        },
        ""
      ]
    }
  },
  "toast.backupIncompatible": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "La copia es incompatible: ",
        {
          "$op": "coalesce",
          "left": {
            "$op": "arg",
            "name": "reason"
          },
          "right": "no se pudo confirmar la compatibilidad"
        },
        ""
      ]
    }
  },
  "toast.backupPreviewFailed": "No se pudo mostrar la vista previa de la copia. Comprueba el archivo e inténtalo de nuevo.",
  "toast.backupRestoreFailed": "La restauración no se completó. La aplicación conservó o restauró los datos originales cuando fue posible; conserva los registros de diagnóstico si se solicita reiniciar o no se puede escribir.",
  "toast.backupRestoreSuccess": "Copia restaurada. Actualizando.",
  "toast.cleanupFailed": "No se pudieron eliminar los registros del historial. Inténtalo más tarde.",
  "toast.cleanupSuccess": "Registros del historial eliminados.",
  "toast.feedbackOpenFailed": "No se pudo abrir el enlace de comentarios.",
  "toast.legacyBackupRestoreSuccess": "Copia del formato anterior restaurada. Crea ahora una nueva copia de instantánea SQLite.",
  "toast.releaseNotesOpenFailed": "No se pudieron abrir las notas de la versión.",
  "toast.repositoryOpenFailed": "No se pudo abrir el enlace de GitHub.",
  "toast.settingsRuntimeSyncPartial": "Configuración guardada. Algunos cambios se aplicarán tras la próxima actualización de la vista.",
  "toast.supportOpenFailed": "No se pudo abrir el enlace de apoyo.",
  "toast.webDavConfigDeleted": "Configuración de WebDAV eliminada.",
  "toast.webDavConfigDeleteFailed": "No se pudo eliminar la configuración de WebDAV. Inténtalo más tarde.",
  "toast.webDavConfigSaved": "Configuración de WebDAV guardada.",
  "toast.webDavConfigSaveFailed": "No se pudo guardar la configuración de WebDAV. Revísala e inténtalo de nuevo.",
  "toast.webDavDownloadFailed": "La descarga o restauración de la copia remota falló. Los datos locales no se modificaron.",
  "toast.webDavListFailed": "No se pudo leer la lista de copias remotas.",
  "toast.webDavMissingConfig": "Configura WebDAV y guarda primero la contraseña.",
  "toast.webDavMissingPassword": "Introduce la contraseña de WebDAV o la contraseña de aplicación.",
  "toast.webDavTestFailed": "La conexión WebDAV falló. Comprueba la dirección, el usuario y la contraseña de aplicación.",
  "toast.webDavTestSuccess": "La conexión WebDAV está disponible.",
  "toast.webDavUploadFailed": "La subida de la copia remota falló. Los datos locales no se modificaron.",
  "toast.webDavUploadIndexWarning": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Copia remota subida: ",
        {
          "$op": "arg",
          "name": "fileName"
        },
        ", pero no se pudo actualizar la lista."
      ]
    }
  },
  "toast.webDavUploadSuccess": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "Copia remota subida: ",
        {
          "$op": "arg",
          "name": "fileName"
        },
        ""
      ]
    }
  }
} as const;
