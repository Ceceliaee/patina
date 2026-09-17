import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { waitFor } from "./uiBrowserSmoke/browserHarness.ts";

export async function verifyAppIconRuntime(evaluate: (expression: string) => Promise<unknown>, dbPath: string) {
  const exe = "runtime-restore-original.exe";
  const icons = await evaluate(`['#e02020', '#2040d0'].map(color => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 16, 16);
    return canvas.toDataURL();
  })`) as string[];
  const hasIcon = (icon: string) => evaluate(`Array.from(document.querySelectorAll('img')).some(img => img.src === ${JSON.stringify(icon)})`);
  for (const icon of icons) {
    const result = spawnSync("python", ["-c", [
      "import sqlite3,sys",
      "db=sqlite3.connect(sys.argv[1])",
      "db.execute('INSERT INTO icon_cache (exe_name,icon_base64,last_updated) VALUES (?,?,100) ON CONFLICT(exe_name) DO UPDATE SET icon_base64=excluded.icon_base64,last_updated=excluded.last_updated',(sys.argv[2],sys.argv[3]))",
      "db.commit()", "db.close()",
    ].join("; "), dbPath, exe, icon], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    await evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {event:'app-icon-changed', payload:${JSON.stringify(exe)}})`);
    await waitFor("real WebView reflects committed icon change", () => hasIcon(icon), 10_000);
  }
  assert.equal(await hasIcon(icons[0]), false, "old cached image must not survive the change");
  console.log("PASS real Tauri icon event, SQLite reread and in-place WebView image replacement");
}
