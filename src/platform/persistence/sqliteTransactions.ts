export function createSerializedJobRunner() {
  let tail = Promise.resolve();

  return async function runSerializedJob<T>(job: () => Promise<T>): Promise<T> {
    const previous = tail;
    let releaseCurrent!: () => void;
    tail = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    await previous;
    try {
      return await job();
    } finally {
      releaseCurrent();
    }
  };
}
