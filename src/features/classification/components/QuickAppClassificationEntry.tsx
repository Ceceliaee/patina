import { lazy, Suspense, type ComponentProps } from "react";

type QuickAppClassificationSurfaceModule = typeof import("./QuickAppClassificationSurface.tsx");

let quickAppClassificationSurfaceModule: Promise<QuickAppClassificationSurfaceModule> | null = null;

function loadQuickAppClassificationSurface() {
  quickAppClassificationSurfaceModule ??= import("./QuickAppClassificationSurface.tsx").catch(
    (error: unknown) => {
      quickAppClassificationSurfaceModule = null;
      throw error;
    },
  );
  return quickAppClassificationSurfaceModule;
}

const LazyQuickAppClassificationSurface = lazy(loadQuickAppClassificationSurface);

type Props = ComponentProps<
  typeof import("./QuickAppClassificationSurface.tsx")["default"]
>;

export function preloadQuickAppClassificationEntry() {
  return loadQuickAppClassificationSurface();
}

export default function QuickAppClassificationEntry(props: Props) {
  return (
    <Suspense fallback={null}>
      <LazyQuickAppClassificationSurface {...props} />
    </Suspense>
  );
}
