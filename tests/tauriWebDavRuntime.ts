import assert from "node:assert/strict";
import { createServer } from "node:http";

export async function verifyWebDavRuntime(evaluate: (expression: string) => Promise<unknown>) {
  const directories = new Set(["/dav/"]);
  const files = new Map<string, Buffer>();
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    const path = decodeURI(request.url ?? "/");
    const method = request.method ?? "";
    calls.push(`${method} ${path}`);
    const finish = (status: number, body: string | Buffer = "") => {
      response.writeHead(status, { "Content-Length": Buffer.byteLength(body), ETag: '"fixture-etag"' });
      response.end(body);
    };
    if (method === "PROPFIND") {
      if (!directories.has(path)) return finish(404);
      return finish(207, `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${request.url}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    }
    if (method === "MKCOL") {
      if (directories.has(path)) return finish(405);
      const parent = path.slice(0, -1).slice(0, path.slice(0, -1).lastIndexOf("/") + 1);
      if (!directories.has(parent)) return finish(409);
      directories.add(path);
      return finish(201);
    }
    if (method === "PUT") {
      if (!directories.has(path.slice(0, path.lastIndexOf("/") + 1))) return finish(409);
      if (request.headers["if-none-match"] === "*" && files.has(path)) return finish(412);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const existed = files.has(path);
      files.set(path, Buffer.concat(chunks));
      return finish(existed ? 204 : 201);
    }
    if (method === "GET") return files.has(path) ? finish(200, files.get(path)!) : finish(404);
    return finish(405);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const config = { url: `http://127.0.0.1:${address.port}/dav/runtime/new`, username: "runtime-fixture", remoteDir: "/Patina" };
  const invoke = (command: string, payload: unknown) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(payload)})`);
  try {
    await invoke("cmd_save_webdav_backup_secret", { username: config.username, password: "fixture-only" });
    const first = await invoke("cmd_upload_webdav_backup", { config, fileName: "工作备份.zip" }) as { entry: { id: string; fileName: string }; indexUpdated: boolean };
    assert.equal(first.entry.fileName, "工作备份.zip");
    assert.equal(first.indexUpdated, true);
    assert.ok(directories.has("/dav/runtime/new/Patina/"));
    const file = files.get("/dav/runtime/new/Patina/工作备份.zip");
    assert.ok(file && file.length > 0);
    await assert.rejects(invoke("cmd_upload_webdav_backup", { config, fileName: "工作备份.zip" }), /remote_name_conflict/);
    assert.deepEqual(files.get("/dav/runtime/new/Patina/工作备份.zip"), file);
    const second = await invoke("cmd_upload_webdav_backup", { config, fileName: "another backup.zip" }) as typeof first;
    assert.notEqual(first.entry.id, second.entry.id);
    const entries = await invoke("cmd_list_webdav_backups", { config }) as Array<{ id: string }>;
    assert.equal(entries.length, 2);
    const downloaded = await invoke("cmd_download_webdav_backup", { config, id: first.entry.id }) as {
      path: string; preview: { hash: string; restore_supported: boolean };
    };
    try {
      assert.equal(downloaded.preview.restore_supported, true);
      await invoke("cmd_restore_backup", { backupPath: downloaded.path, hash: downloaded.preview.hash, restoreStrategy: "merge" });
    } finally { await invoke("cmd_delete_remote_backup_temp", { path: downloaded.path }); }
    const priorCalls = calls.length;
    await assert.rejects(invoke("cmd_upload_webdav_backup", { config, fileName: "../outside.zip" }), /webdav_invalid_file_name/);
    assert.equal(calls.length, priorCalls);
    console.log("PASS real WebDAV IPC creates parents, preserves custom names, rejects overwrite, and restores indexed ZIP");
  } finally {
    try { await invoke("cmd_delete_webdav_backup_secret", {}); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }
}
