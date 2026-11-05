import { colorContrast } from "../src/shared/colors/oklab.ts";
import { activityDisplayColor } from "../src/shared/colors/displayColor.ts";
import { iconRepresentative } from "../src/shared/colors/iconRepresentative.ts";
import assert from "node:assert/strict";
import {
  __iconThemeColorInternals,
  configureIconThemeColorPersistence,
  prewarmIconThemeColors,
} from "../src/shared/hooks/useIconThemeColors.ts";
import {
  __iconThemeColorStoreInternals,
  iconThemeColorStore,
} from "../src/platform/persistence/iconThemeColorStore.ts";

const SIZE = 48;

type Rgba = [number, number, number, number?];

function createIcon(color: Rgba) {
  const [r, g, b, a = 255] = color;
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = a;
  }
  return data;
}

function fillRect(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgba,
) {
  const [r, g, b, a = 255] = color;
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const offset = ((row * SIZE) + col) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
}

let passed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("transparent padding and empty icons", () => {
  const data = createIcon([0, 0, 0, 0]);
  assert.equal(iconRepresentative(data, SIZE), null);
  fillRect(data, 14, 14, 20, 20, [69, 135, 244]);
  assert.deepEqual(iconRepresentative(data, SIZE), { kind: "color", color: "#4587F4" });
});

await runTest("monochrome plates distinguish dark icons and light icons with a darker subject", () => {
  const dark = createIcon([0, 0, 0]);
  fillRect(dark, 16, 20, 16, 8, [255, 255, 255]);
  assert.deepEqual(iconRepresentative(dark, SIZE), { kind: "dark", color: "#000000" });
  const light = createIcon([255, 255, 255]);
  fillRect(light, 14, 14, 20, 20, [42, 42, 42]);
  assert.deepEqual(iconRepresentative(light, SIZE), { kind: "light", color: "#2A2A2A" });
});

await runTest("single hue and multiple hues use separate inclusive area thresholds", () => {
  const data = createIcon([76, 76, 76]);
  fillRect(data, 0, 0, 4, 48, [255, 0, 0]);
  assert.equal(iconRepresentative(data, SIZE)?.kind, "dark");
  fillRect(data, 4, 0, 1, 48, [255, 0, 0]);
  assert.equal(iconRepresentative(data, SIZE)?.kind, "color");
  fillRect(data, 4, 0, 4, 48, [0, 255, 0]);
  fillRect(data, 8, 0, 4, 48, [0, 0, 255]);
  assert.equal(iconRepresentative(data, SIZE)?.kind, "color");
  fillRect(data, 11, 0, 1, 48, [76, 76, 76]);
  assert.equal(iconRepresentative(data, SIZE)?.kind, "dark");
});

await runTest("display colors meet the theme minimum and retain passing originals", () => {
  for (const [mode, background, target] of [["light", "#FFFFFF", 2], ["dark", "#2D2D2D", 3]] as const) {
    for (const source of ["#FFFFFF", "#000000", "#07254D", "#BFE99C", "#555555"]) {
      const color = activityDisplayColor(source, background, mode);
      assert.ok(colorContrast(color, background) >= target);
      if (colorContrast(source, background) >= target) assert.equal(color, source);
    }
  }
});

await runTest("resolved icon colors are synchronously reusable on remount", async () => {
  __iconThemeColorInternals.resetThemeColorCaches();
  let extractionCount = 0;
  const icons = { "example.exe": "first-icon" };

  assert.deepEqual(__iconThemeColorInternals.readCachedThemeColors(icons), {});
  await __iconThemeColorInternals.resolveThemeColor(
    icons["example.exe"],
    async () => {
      extractionCount += 1;
      return "#123456";
    },
  );

  assert.equal(extractionCount, 1);
  assert.deepEqual(
    __iconThemeColorInternals.readCachedThemeColors(icons),
    { "example.exe": "#123456" },
  );
});

await runTest("matching concurrent icon color requests share one extraction", async () => {
  __iconThemeColorInternals.resetThemeColorCaches();
  let extractionCount = 0;
  let releaseExtraction!: (color: string | null) => void;
  const extraction = new Promise<string | null>((resolve) => {
    releaseExtraction = resolve;
  });
  const extractor = async () => {
    extractionCount += 1;
    return extraction;
  };

  const first = __iconThemeColorInternals.resolveThemeColor("shared-icon", extractor);
  const second = __iconThemeColorInternals.resolveThemeColor("shared-icon", extractor);
  await Promise.resolve();
  assert.equal(extractionCount, 1);

  releaseExtraction("#654321");
  assert.deepEqual(await Promise.all([first, second]), ["#654321", "#654321"]);
});

await runTest("cached icon colors are scoped to the current icon source", async () => {
  __iconThemeColorInternals.resetThemeColorCaches();
  await __iconThemeColorInternals.resolveThemeColor(
    "old-icon",
    async () => "#123456",
  );

  assert.deepEqual(
    __iconThemeColorInternals.readCachedThemeColors({ "example.exe": "old-icon" }),
    { "example.exe": "#123456" },
  );
  assert.deepEqual(
    __iconThemeColorInternals.readCachedThemeColors({ "example.exe": "new-icon" }),
    {},
  );
});

await runTest("failed icon extraction fallbacks remain stable across remounts", async () => {
  __iconThemeColorInternals.resetThemeColorCaches();
  const resolved = await __iconThemeColorInternals.resolveThemeColor(
    "broken-icon",
    async () => null,
  );

  assert.equal(resolved, null);
  assert.deepEqual(
    __iconThemeColorInternals.readCachedThemeColors({ "example.exe": "broken-icon" }),
    {},
  );
});

await runTest("successful and failed source entries evict old values while retaining recent hits", async () => {
  for (const extracted of ["#123456", null]) {
    __iconThemeColorInternals.resetThemeColorCaches();
    let extractions = 0;
    const extractor = async () => {
      extractions += 1;
      return extracted;
    };
    for (let index = 0; index < 256; index += 1) {
      await __iconThemeColorInternals.resolveThemeColor(`source-${index}`, extractor);
    }
    const expected = extracted ? { app: extracted } : {};
    assert.deepEqual(
      __iconThemeColorInternals.readCachedThemeColors({ app: "source-0" }),
      expected,
    );
    await __iconThemeColorInternals.resolveThemeColor("source-256", extractor);
    assert.deepEqual(__iconThemeColorInternals.readCachedThemeColors({ app: "source-1" }), {});
    assert.deepEqual(
      __iconThemeColorInternals.readCachedThemeColors({ app: "source-0" }),
      expected,
    );
    assert.deepEqual(
      __iconThemeColorInternals.readCachedThemeColors({ app: "source-256" }),
      expected,
    );
    await __iconThemeColorInternals.resolveThemeColor("source-1", extractor);
    assert.equal(extractions, 258, "an evicted source is extracted again");
  }
});

await runTest("one failed source serves new identifiers without retaining per-identifier state", async () => {
  __iconThemeColorInternals.resetThemeColorCaches();
  let extractions = 0;
  for (let index = 0; index < 600; index += 1) {
    assert.equal(
      await __iconThemeColorInternals.resolveThemeColor("shared-broken-source", async () => {
        extractions += 1;
        return null;
      }),
      null,
    );
  }
  assert.equal(extractions, 1);
  const freshIdentifier = "not-previously-requested.exe";
  assert.deepEqual(
    __iconThemeColorInternals.readCachedThemeColors({ [freshIdentifier]: "shared-broken-source" }),
    {},
  );
});

await runTest("reset isolates unresolved extraction and persistence from the new request", async () => {
  __iconThemeColorInternals.resetThemeColorCaches();
  const persisted: string[] = [];
  configureIconThemeColorPersistence({ read: () => null, remember: (_source, color) => persisted.push(color) });
  try {
    let releaseOld!: (color: string) => void;
    let releaseNew!: (color: string) => void;
    const old = __iconThemeColorInternals.resolveThemeColor("shared", () => new Promise((resolve) => {
      releaseOld = resolve;
    }));
    await Promise.resolve();
    __iconThemeColorInternals.resetThemeColorCaches();
    let newExtractions = 0;
    const next = __iconThemeColorInternals.resolveThemeColor("shared", () => {
      newExtractions += 1;
      return new Promise((resolve) => { releaseNew = resolve; });
    });
    await Promise.resolve();
    releaseOld("#111111");
    assert.equal(await old, "#111111");
    assert.deepEqual(__iconThemeColorInternals.readCachedThemeColors({ app: "shared" }), {});
    assert.deepEqual(persisted, []);
    const concurrent = __iconThemeColorInternals.resolveThemeColor("shared", async () => {
      newExtractions += 1;
      return "#333333";
    });
    releaseNew("#222222");
    assert.deepEqual(await Promise.all([next, concurrent]), ["#222222", "#222222"]);
    assert.equal(newExtractions, 1);
    assert.deepEqual(persisted, ["#222222"]);
    assert.deepEqual(
      __iconThemeColorInternals.readCachedThemeColors({ app: "shared" }),
      { app: "#222222" },
    );
  } finally {
    configureIconThemeColorPersistence(null);
    __iconThemeColorInternals.resetThemeColorCaches();
  }
});

await runTest("prewarming more sources than the cache retains returns every requested color", async () => {
  const originals = ["Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  class TestImage {
    src = "";
    naturalWidth = SIZE;
    naturalHeight = SIZE;
    async decode() {
      if (this.src.includes("broken")) throw new Error("fixture decode failure");
    }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        getContext: () => ({
          clearRect: () => undefined,
          drawImage: () => undefined,
          getImageData: () => ({ data: createIcon([69, 135, 244]) }),
        }),
      }),
    },
  });
  try {
    for (const sourceKind of ["valid", "broken"]) {
      __iconThemeColorInternals.resetThemeColorCaches();
      const icons = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`app-${index}`, `${sourceKind}-${index}`]));
      const colors = await prewarmIconThemeColors(icons);
      assert.equal(Object.keys(colors).length, sourceKind === "valid" ? 300 : 0);
      for (const identifier of Object.keys(icons)) {
        assert.equal(colors[identifier], sourceKind === "valid" ? "#4587F4" : undefined);
      }
      assert.deepEqual(__iconThemeColorInternals.readCachedThemeColors({ first: icons["app-0"] }), {});
    }
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    __iconThemeColorInternals.resetThemeColorCaches();
  }
});

await runTest("extracted colors survive a rebuilt WebView and invalidate when the icon changes", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  try {
    configureIconThemeColorPersistence(iconThemeColorStore);
    __iconThemeColorStoreInternals.clearPersistentCache();
    __iconThemeColorInternals.resetThemeColorCaches();

    await __iconThemeColorInternals.resolveThemeColor(
      "stable-icon",
      async () => "#123456",
    );
    __iconThemeColorStoreInternals.flushPersistedColors();

    __iconThemeColorInternals.resetThemeColorCaches();
    __iconThemeColorStoreInternals.clearMemoryCache();
    assert.deepEqual(
      __iconThemeColorInternals.readCachedThemeColors({ "example.exe": "stable-icon" }),
      { "example.exe": "#123456" },
    );
    assert.deepEqual(
      __iconThemeColorInternals.readCachedThemeColors({ "example.exe": "changed-icon" }),
      {},
    );
  } finally {
    __iconThemeColorStoreInternals.clearPersistentCache();
    __iconThemeColorInternals.resetThemeColorCaches();
    configureIconThemeColorPersistence(null);
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
});

console.log(`Passed ${passed} icon theme color tests`);
