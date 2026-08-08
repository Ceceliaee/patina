import { lazy, Suspense, type ComponentProps } from "react";

type QuickClassificationSurfaceModule = typeof import("./QuickClassificationSurface.tsx");

let quickClassificationSurfaceModule: Promise<QuickClassificationSurfaceModule> | null = null;

function loadQuickClassificationSurface() {
  quickClassificationSurfaceModule ??= import("./QuickClassificationSurface.tsx").catch(
    (error: unknown) => {
      quickClassificationSurfaceModule = null;
      throw error;
    },
  );
  return quickClassificationSurfaceModule;
}

const LazyQuickClassificationSurface = lazy(loadQuickClassificationSurface);

type Props = ComponentProps<
  typeof import("./QuickClassificationSurface.tsx")["default"]
>;

export function preloadQuickClassificationEntry() {
  return loadQuickClassificationSurface();
}

export default function QuickClassificationEntry(props: Props) {
  return (
    <Suspense fallback={null}>
      <LazyQuickClassificationSurface {...props} />
    </Suspense>
  );
}
