import assert from "node:assert/strict";
import { __iconThemeColorInternals } from "../src/shared/hooks/useIconThemeColors.ts";

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

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

runTest("transparent pixels do not pollute icon theme color", () => {
  const data = createIcon([0, 0, 0, 0]);
  fillRect(data, 14, 14, 20, 20, [69, 135, 244]);

  assert.equal(__iconThemeColorInternals.chooseDominantColor(data, SIZE), "#4587f4");
});

runTest("light edge background is removed before choosing the subject color", () => {
  const data = createIcon([220, 210, 190]);
  fillRect(data, 12, 12, 24, 24, [255, 105, 154]);

  assert.equal(__iconThemeColorInternals.chooseDominantColor(data, SIZE), "#ff699a");
});

runTest("dark edge color is protected as a possible subject color", () => {
  const data = createIcon([0, 1, 1]);
  fillRect(data, 18, 18, 12, 12, [255, 105, 154]);

  assert.equal(__iconThemeColorInternals.chooseDominantColor(data, SIZE), "#000101");
});

runTest("near-white background is filtered without removing colored subjects", () => {
  const data = createIcon([246, 246, 244]);
  fillRect(data, 12, 12, 24, 24, [82, 82, 82]);

  assert.equal(__iconThemeColorInternals.chooseDominantColor(data, SIZE), "#525252");
});

runTest("light background ramps do not beat a darker neutral subject", () => {
  const data = createIcon([254, 254, 254]);
  fillRect(data, 8, 8, 32, 32, [226, 226, 226]);
  fillRect(data, 18, 18, 12, 12, [82, 82, 82]);

  assert.equal(__iconThemeColorInternals.chooseDominantColor(data, SIZE), "#525252");
});

runTest("dominant light neutral background is filtered even when it is padded away from edges", () => {
  const data = createIcon([0, 0, 0, 0]);
  fillRect(data, 8, 8, 32, 32, [226, 226, 226]);
  fillRect(data, 16, 16, 16, 16, [82, 82, 82]);

  assert.equal(__iconThemeColorInternals.chooseDominantColor(data, SIZE), "#525252");
});

runTest("light neutral buckets cannot beat smaller subject buckets", () => {
  const data = createIcon([0, 0, 0, 0]);
  fillRect(data, 0, 0, 24, 48, [226, 226, 226]);
  fillRect(data, 24, 0, 18, 48, [218, 218, 218]);
  fillRect(data, 18, 16, 12, 16, [82, 82, 82]);

  assert.equal(__iconThemeColorInternals.chooseDominantColor(data, SIZE), "#525252");
});

runTest("light neutral subject survives when there is no background evidence", () => {
  const data = createIcon([0, 0, 0, 0]);
  fillRect(data, 14, 14, 20, 20, [205, 190, 200]);

  assert.equal(__iconThemeColorInternals.chooseDominantColor(data, SIZE), "#cdbec8");
});

runTest("fallback colors are stable and come from the fixed palette", () => {
  const first = __iconThemeColorInternals.fallbackThemeColor("example.com");
  const second = __iconThemeColorInternals.fallbackThemeColor("example.com");

  assert.equal(first, second);
  assert.match(first, /^#[0-9A-F]{6}$/);
});

console.log(`Passed ${passed} icon theme color tests`);
