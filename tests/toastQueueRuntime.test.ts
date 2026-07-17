import assert from "node:assert/strict";
import {
  createToastQueueRuntime,
  type ToastQueueScheduler,
} from "../src/app/services/toastQueueRuntime.ts";
import type { QuietToastItem } from "../src/shared/types/toast.ts";

function createFakeScheduler() {
  let nextTimerId = 1;
  const pending = new Map<number, () => void>();
  const cancelled: number[] = [];

  const scheduler: ToastQueueScheduler = {
    schedule(callback) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      pending.set(timerId, callback);
      return timerId;
    },
    cancel(timerId) {
      cancelled.push(timerId);
      pending.delete(timerId);
    },
  };

  return {
    scheduler,
    cancelled,
    pendingIds: () => [...pending.keys()],
    run(timerId: number) {
      const callback = pending.get(timerId);
      assert.ok(callback, `missing pending timer ${timerId}`);
      pending.delete(timerId);
      callback();
    },
  };
}

function createRuntime(maxVisible = 3) {
  const fakeScheduler = createFakeScheduler();
  const updates: QuietToastItem[][] = [];
  const runtime = createToastQueueRuntime({
    dismissAfterMs: 3200,
    maxVisible,
    scheduler: fakeScheduler.scheduler,
    onChange: (toasts) => updates.push(toasts),
  });
  return { fakeScheduler, runtime, updates };
}

{
  const { fakeScheduler, runtime } = createRuntime();
  runtime.push("保存失败", "error");
  const originalToast = runtime.snapshot()[0];
  const originalTimer = fakeScheduler.pendingIds()[0];

  runtime.push("保存失败", "error");

  assert.deepEqual(runtime.snapshot(), [originalToast]);
  assert.deepEqual(fakeScheduler.cancelled, [originalTimer]);
  assert.equal(fakeScheduler.pendingIds().length, 1);
}

{
  const { fakeScheduler, runtime } = createRuntime(3);
  runtime.push("一", "info");
  runtime.push("二", "success");
  runtime.push("三", "warning");
  const oldestTimer = fakeScheduler.pendingIds()[0];
  runtime.push("四", "error");

  assert.deepEqual(runtime.snapshot().map((toast) => toast.message), ["二", "三", "四"]);
  assert.ok(fakeScheduler.cancelled.includes(oldestTimer));
  assert.equal(fakeScheduler.pendingIds().length, 3);
}

{
  const { fakeScheduler, runtime, updates } = createRuntime();
  runtime.push("即将过期", "info");
  const expirationTimer = fakeScheduler.pendingIds()[0];
  fakeScheduler.run(expirationTimer);

  assert.deepEqual(runtime.snapshot(), []);
  assert.deepEqual(updates.at(-1), []);
}

{
  const { fakeScheduler, runtime, updates } = createRuntime();
  runtime.push("卸载前提示", "warning");
  const updateCountBeforeDispose = updates.length;
  const timerIds = fakeScheduler.pendingIds();

  runtime.dispose();
  runtime.push("卸载后提示", "error");

  assert.deepEqual(runtime.snapshot(), []);
  assert.equal(updates.length, updateCountBeforeDispose);
  assert.deepEqual(fakeScheduler.cancelled, timerIds);
  assert.deepEqual(fakeScheduler.pendingIds(), []);
}

{
  const { runtime } = createRuntime();
  runtime.push("同一文案", "warning");
  runtime.push("同一文案", "error");

  assert.deepEqual(runtime.snapshot().map((toast) => toast.tone), ["warning", "error"]);
}

console.log("Toast queue runtime tests passed");
