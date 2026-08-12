import { createContext, useContext, type ReactNode } from "react";
import UpdateConfirmDialog from "../../features/update/components/UpdateConfirmDialog";
import type { UpdateSnapshot } from "../../shared/types/update";
import { useUpdateState } from "../hooks/useUpdateState";
import { shouldOpenUpdateDialogForSnapshot } from "../../features/update/services/updateViewModel";

interface UpdateDialogContextValue {
  snapshot: UpdateSnapshot;
  isChecking: boolean;
  isInstalling: boolean;
  dialogOpen: boolean;
  shouldShowCompactEntry: boolean;
  openUpdateDialog: () => void;
  closeUpdateDialog: () => void;
  checkForUpdates: (silent: boolean) => Promise<UpdateSnapshot>;
  confirmUpdateAction: () => Promise<UpdateSnapshot>;
  openReleasePage: () => Promise<void>;
  openAssetDownload: () => Promise<void>;
}

const UpdateDialogContext = createContext<UpdateDialogContextValue | null>(null);

interface UpdateDialogProviderProps {
  children: ReactNode;
}

export default function UpdateDialogProvider({ children }: UpdateDialogProviderProps) {
  const updateState = useUpdateState();

  const contextValue: UpdateDialogContextValue = {
    snapshot: updateState.snapshot,
    isChecking: updateState.isChecking,
    isInstalling: updateState.isInstalling,
    dialogOpen: updateState.dialogOpen,
    shouldShowCompactEntry: updateState.shouldShowCompactEntry,
    openUpdateDialog: () => {
      if (shouldOpenUpdateDialogForSnapshot(updateState.snapshot)) {
        updateState.openDialog();
      }
    },
    closeUpdateDialog: updateState.closeDialog,
    checkForUpdates: updateState.checkForUpdates,
    confirmUpdateAction: updateState.confirmUpdateAction,
    openReleasePage: updateState.openReleasePage,
    openAssetDownload: updateState.openAssetDownload,
  };

  return (
    <UpdateDialogContext.Provider value={contextValue}>
      {children}
      <UpdateConfirmDialog
        open={updateState.dialogOpen}
        snapshot={updateState.snapshot}
        installing={updateState.isInstalling}
        onClose={updateState.closeDialog}
        onRetryCheck={() => {
          void updateState.checkForUpdates(false);
        }}
        onOpenReleasePage={() => {
          void updateState.openReleasePage();
        }}
        onOpenAssetDownload={() => {
          void updateState.openAssetDownload();
        }}
        onConfirm={() => {
          void updateState.confirmUpdateAction();
        }}
      />
    </UpdateDialogContext.Provider>
  );
}

export function useUpdateDialog() {
  const context = useContext(UpdateDialogContext);
  if (!context) {
    throw new Error("useUpdateDialog must be used inside UpdateDialogProvider");
  }
  return context;
}
