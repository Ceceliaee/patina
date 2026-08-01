import { lazy, Suspense, type ComponentProps } from "react";

type DestinationDetailDialogModule = typeof import("./DestinationDetailDialog.tsx");

let destinationDetailDialogModule: Promise<DestinationDetailDialogModule> | null = null;

function loadDestinationDetailDialog() {
  destinationDetailDialogModule ??= import("./DestinationDetailDialog.tsx").catch(
    (error: unknown) => {
      destinationDetailDialogModule = null;
      throw error;
    },
  );
  return destinationDetailDialogModule;
}

const LazyDestinationDetailDialog = lazy(loadDestinationDetailDialog);

type Props = ComponentProps<
  typeof import("./DestinationDetailDialog.tsx")["default"]
>;

export function preloadDestinationDetailDialog() {
  return loadDestinationDetailDialog();
}

export default function DestinationDetailDialogEntry(props: Props) {
  return (
    <Suspense fallback={null}>
      <LazyDestinationDetailDialog {...props} />
    </Suspense>
  );
}
