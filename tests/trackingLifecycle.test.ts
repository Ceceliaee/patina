import {
  finishTrackingLifecycleTests,
} from "./trackingLifecycle/shared.ts";
import { runCompilerAndAggregationTests } from "./trackingLifecycle/compilerAndAggregation.ts";
import { runHistoryReadModelTests } from "./trackingLifecycle/historyReadModel.ts";
import { runLifecycleCoreTests } from "./trackingLifecycle/lifecycleCore.ts";
import { runProcessMapperTests } from "./trackingLifecycle/processMapper.ts";
import { runReadModelRuntimeTests } from "./trackingLifecycle/readModelRuntime.ts";
import { runRuntimeEffectsTests } from "./trackingLifecycle/runtimeEffects.ts";

runLifecycleCoreTests();
runRuntimeEffectsTests();
runHistoryReadModelTests();
runReadModelRuntimeTests();
runCompilerAndAggregationTests();
runProcessMapperTests();

await finishTrackingLifecycleTests();
