import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { CdpConnection, evaluate, getBrowserWebSocketUrl, launchBrowser, removeIsolatedBrowserDataDir, stopBrowser, waitForExpression } from '../../tests/uiBrowserSmoke/browserHarness.ts';
import { tauriBrowserSmokeStubPlugin } from '../../tests/uiBrowserSmoke/tauriStubs.ts';

const label = process.argv[2] ?? 'candidate';
assert.match(label, /^[a-z0-9-]+$/);
const output = resolve('artifacts/classification-performance', label);
mkdirSync(output, { recursive: true });
const outDir = resolve(output, 'dist');
const diff = execFileSync('git', ['diff', '--binary'], { encoding: 'utf8' });
writeFileSync(resolve(output, 'tracked-diff.patch'), diff);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const metadata = {
  label, measuredAt: new Date().toISOString(), node: process.version, os: release(),
  cpu: cpus()[0]?.model, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  diffHash: hash(diff), lockHash: hash(readFileSync('pnpm-lock.yaml')),
  menuHash: hash(readFileSync('src/features/classification/components/LinkedAppMenu.tsx')),
  harnessHash: hash(readFileSync(import.meta.filename)),
  mode: 'production; Tauri/SQL stubs; no real database writes', viewport: '1280x820@1',
  browser: '', warmups: 2, samples: 20, coldProfiles: 5,
};
await build({ configFile: 'vite.config.ts', logLevel: 'error', plugins: [tauriBrowserSmokeStubPlugin()],
  build: { outDir, emptyOutDir: true } });
const server = await preview({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
const samples: Array<{ count: number; run: number; operation: string; ms: number; nodes: number; longTasks: number; longTaskMs: number }> = [];
const failures: Array<{ count: number; run: number; message: string }> = [];
function save() { writeFileSync(resolve(output, 'measurements.json'), JSON.stringify({ metadata, samples, failures }, null, 2)); }
try {
 for (const count of [40, 130, 500, 1500]) {
  for (let profile = 0; profile < 5; profile++) {
   const browser = await launchBrowser();
   let client: CdpConnection | undefined;
   try {
    client = await CdpConnection.connect(await getBrowserWebSocketUrl(browser.port));
    metadata.browser = String((await client.command('Browser.getVersion')).product);
    const { targetId } = await client.command('Target.createTarget', { url: 'about:blank' });
    const { sessionId: session } = await client.command('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = String(session);
    await client.command('Runtime.enable', {}, sessionId);
    await client.command('Page.enable', {}, sessionId);
    await client.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
    await client.command('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('__patina_catalog_size','${count}');
      localStorage.setItem('__time_tracker_enable_classification_catalog_fixture','1');
      globalThis.__perfTasks=[]; new PerformanceObserver(list=>globalThis.__perfTasks.push(...list.getEntries().map(x=>({start:x.startTime,duration:x.duration})))).observe({type:'longtask'});
    ` }, sessionId);
    await client.command('Page.navigate', { url: server.resolvedUrls!.local[0] }, sessionId);
    await waitForExpression(client, sessionId, `!!document.querySelector('[aria-label="分类"]')`, 15000);
    const measure = async (operation: string, action: string, ready: string, run: number) => {
      const result = await evaluate(client!, sessionId, `new Promise((resolve,reject)=>{
       const start=performance.now(); ${action};
       function check(){if(${ready})requestAnimationFrame(()=>requestAnimationFrame(()=>{
        const tasks=globalThis.__perfTasks.filter(x=>x.start>=start);
        resolve({ms:performance.now()-start,nodes:document.querySelectorAll('*').length,longTasks:tasks.length,longTaskMs:tasks.reduce((sum,x)=>sum+x.duration,0)});
       }));else if(performance.now()-start>12000)reject(new Error('condition timeout: ${operation}; cards='+document.querySelectorAll('.qp-app-link-trigger').length));else requestAnimationFrame(check);}check();})`) as { ms: number; nodes: number; longTasks: number; longTaskMs: number };
      samples.push({ count, run, operation, ...result }); save();
    };
    const cards = (n: number) => `document.querySelectorAll('.qp-app-link-trigger').length===${n}`;
    const nav = (name: string) => `document.querySelector('[aria-label="${name}"]').click()`;
    const menu = `document.querySelector('[data-classification-app="catalog-000.exe"] .qp-app-link-trigger').click()`;
    const input = (query: string) => `const el=document.querySelector('input[placeholder="搜索应用"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(query)});el.dispatchEvent(new Event('input',{bubbles:true}))`;
    const close = async () => {
      await client!.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
      await client!.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
      await waitForExpression(client!, sessionId, `!document.querySelector('.qp-app-link-popover')`);
    };
    await measure('cold-open', nav('分类'), cards(count), profile);
    if (profile > 0) continue;
    for (let run = -2; run < 20; run++) {
      await evaluate(client, sessionId, `${nav('今天')};true`);
      await waitForExpression(client, sessionId, `!document.querySelector('[data-classification-content-state]')`);
      await measure('warm-open', nav('分类'), cards(count), run);
      await measure('search-many', input('Catalog'), cards(count), run);
      await measure('search-one', input('catalog-000'), cards(1), run);
      await measure('search-empty', input('no-match-unique'), cards(0), run);
      await measure('search-clear', input(''), cards(count), run);
      await measure('menu', menu, `!!document.querySelector('.qp-app-link-popover')`, run);
      await measure('add-menu', `document.querySelector('.qp-app-link-action').click()`, `document.querySelectorAll('button.qp-app-link-option').length===${count - 1}`, run);
      await measure('link', `[...document.querySelectorAll('button.qp-app-link-option')].find(n=>n.textContent.includes('catalog-001.exe')).click()`, cards(count - 1), run);
      await close();
      await measure('save-stub', `[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存'&&!n.disabled).click()`, `[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存')?.disabled && JSON.parse(localStorage.getItem('__time_tracker_smoke_settings')||'{}')['__app_link::catalog-001.exe']==='catalog-000.exe'`, run);
      await measure('member-menu', menu, `!!document.querySelector('[aria-label="解除关联: catalog-001.exe"]')`, run);
      await measure('unlink', `document.querySelector('[aria-label="解除关联: catalog-001.exe"]').click()`, cards(count), run);
      await close();
      await measure('save-unlink-stub', `[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存'&&!n.disabled).click()`, `[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='保存')?.disabled && !JSON.parse(localStorage.getItem('__time_tracker_smoke_settings')||'{}')['__app_link::catalog-001.exe']`, run);
      console.error(`[classification-perf] ${label} ${count} run ${run + 1}/20`);
    }
   } catch (error) {
     failures.push({ count, run: profile, message: String(error) }); save();
     console.error(error); process.exitCode = 1;
     break;
   } finally {
     client?.close(); await stopBrowser(browser.browser); await removeIsolatedBrowserDataDir(browser.userDataDir);
   }
  }
 }
} finally {
 save(); await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
console.log(JSON.stringify({ output, samples: samples.length, failures }, null, 2));
