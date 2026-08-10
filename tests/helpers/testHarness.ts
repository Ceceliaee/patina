export function createTestHarness() {
  let passed = 0;
  const pending: Promise<void>[] = [];

  return {
    run(name: string, operation: () => void | Promise<void>) {
      try {
        const result = operation();
        if (result && typeof (result as Promise<void>).then === "function") {
          pending.push(
            Promise.resolve(result)
              .then(() => {
                passed += 1;
                console.log(`PASS ${name}`);
              })
              .catch((error) => {
                console.error(`FAIL ${name}`);
                throw error;
              }),
          );
          return;
        }

        passed += 1;
        console.log(`PASS ${name}`);
      } catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
      }
    },
    async finish(label: string) {
      await Promise.all(pending);
      console.log(`Passed ${passed} ${label} tests`);
    },
  };
}
