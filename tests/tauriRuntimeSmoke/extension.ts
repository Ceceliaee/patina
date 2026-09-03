import assert from "node:assert/strict";
import { createServer } from "node:http";
import { CdpConnection, waitFor } from "../uiBrowserSmoke/browserHarness.ts";

export async function verifyBrowserExtension(options: {
  browserPort: number; page: CdpConnection; bridgePort: number; extensionPath: string;
  focusBrowser: () => Promise<unknown>; focusMain: () => Promise<unknown>;
  invoke: (command:string,args?:Record<string,unknown>)=>Promise<unknown>;
}) {
  const {page,invoke}=options;
  const metadata=await (await fetch(`http://127.0.0.1:${options.browserPort}/json/version`)).json() as {webSocketDebuggerUrl:string};
  const browser=await CdpConnection.connect(metadata.webSocketDebuggerUrl);
  const server=createServer((_request,response)=> { response.setHeader("Content-Type","text/html"); response.end("<!doctype html><title>Timing fixture</title><p>Isolated timing fixture</p>"); });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();
  assert.ok(address && typeof address!=="string");
  const base=`http://127.0.0.1:${address.port}`;
  const select=async (query:string,values:unknown[]=[])=>await invoke("plugin:sql|select",{db:"sqlite:patina.db",query,values}) as Array<{id:number;url:string;end_time:number|null}>;
  const rows=()=>select("SELECT id,url,end_time FROM web_activity_segments WHERE browser_client_id='extension-timing-smoke' ORDER BY id");
  const waitPage=async (url:string)=>waitFor(`real extension records ${new URL(url).pathname}`,async()=>{
    const all=await rows(); return all.find(row=>row.url===url && row.end_time===null) ?? null;
  },8_000);
  let privateWindowId:number|null=null;
  let worker:CdpConnection|null=null;
  try {
    const extension=await browser.command("Extensions.loadUnpacked",{path:options.extensionPath,enableInIncognito:true});
    assert.equal(typeof extension.id,"string");
    const workerTarget=await waitFor("extension worker",async()=>{
      const targets=await (await fetch(`http://127.0.0.1:${options.browserPort}/json/list`)).json() as Array<{type:string;url:string;webSocketDebuggerUrl:string}>;
      return targets.find(target=>target.type==="service_worker" && target.url.startsWith(`chrome-extension://${extension.id}/`)) ?? null;
    });
    worker=await CdpConnection.connect(workerTarget.webSocketDebuggerUrl);
      await waitFor("extension storage ready",async()=>{
        const ready=await worker!.command("Runtime.evaluate",{expression:"typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)",returnByValue:true});
        return (ready.result as {value?:boolean})?.value || null;
      });
      const configured=await worker.command("Runtime.evaluate",{expression:`chrome.storage.local.set(${JSON.stringify({port:String(options.bridgePort),token:"runtime-smoke-bridge-secret",clientId:"extension-timing-smoke"})})`,awaitPromise:true,returnByValue:true});
      assert.equal(configured.exceptionDetails,undefined);
    await options.focusBrowser();
    await waitFor("native browser ready before extension navigation",async()=>{
      const snapshot=await invoke("get_current_tracking_snapshot") as {window:{exe_name:string};status:{is_tracking_active:boolean}};
      return snapshot.status.is_tracking_active && /^(chrome|msedge)\.exe$/i.test(snapshot.window.exe_name) || null;
    });
    await page.command("Page.navigate",{url:`${base}/page-a`});
    const first=await waitPage(`${base}/page-a`);
    console.log("PASS real extension initial foreground page");
    await options.focusMain();
    await waitFor("real extension/native foreground stop",async()=> (await rows()).find(row=>row.id===first.id && row.end_time!==null) ?? null,15_000);
    await options.focusBrowser();
    const returned=await waitPage(`${base}/page-a`);
    assert.notEqual(returned.id,first.id);
    console.log("PASS real extension foreground return starts a new webpage");
    await page.command("Page.navigate",{url:"about:blank"});
    await waitFor("real extension internal page stop",async()=> (await rows()).every(row=>row.end_time!==null) || null,15_000);
    console.log("PASS real extension internal page stop");
    await page.command("Page.navigate",{url:`${base}/page-a`});
    await waitPage(`${base}/page-a`);
    await page.command("Page.navigate",{url:`${base}/page-b`});
    await waitPage(`${base}/page-b`);
    console.log("PASS real extension page navigation");
    const privateWindow=await worker.command("Runtime.evaluate",{expression:`chrome.windows.create({url:${JSON.stringify(`${base}/private-page`)},incognito:true,focused:true})`,awaitPromise:true,returnByValue:true});
    assert.equal(privateWindow.exceptionDetails,undefined);
    privateWindowId=(privateWindow.result as {value:{id:number}}).value.id;
    await waitFor("real extension private window stop",async()=> (await rows()).every(row=>row.end_time!==null) || null,15_000);
    assert.equal((await rows()).some(row=>row.url.includes("private-page")),false,"private URL must not reach storage");
    const removed=await worker.command("Runtime.evaluate",{expression:`chrome.windows.remove(${privateWindowId})`,awaitPromise:true,returnByValue:true});
    assert.equal(removed.exceptionDetails,undefined);
    privateWindowId=null;
    await options.focusBrowser();
    await waitPage(`${base}/page-b`);
    console.log("PASS real Chromium extension: foreground return, internal page, tab navigation, private window and fresh return");
  } catch(error) {
    console.error("TIMING_EXTENSION_FAILURE",String(error));
    try {
    const target=await (await fetch(`http://127.0.0.1:${options.browserPort}/json/list`)).json() as Array<{type:string;url:string;webSocketDebuggerUrl:string}>;
    const workerTarget=target.find(item=>item.type==="service_worker" && item.url.endsWith("/background.js"));
    if(workerTarget) {
      const diagnostic=await CdpConnection.connect(workerTarget.webSocketDebuggerUrl);
      try {
        const state=await diagnostic.command("Runtime.evaluate",{expression:"chrome.storage.local.get(['clientId','lastStatus','lastErrorCode'])",awaitPromise:true,returnByValue:true});
        console.error("TIMING_EXTENSION_DIAGNOSTIC",JSON.stringify(state.result));
      } finally { diagnostic.close(); }
    }
    } catch(diagnosticError) { console.error("TIMING_EXTENSION_DIAGNOSTIC_UNAVAILABLE",String(diagnosticError)); }
    throw error;
  } finally {
    if(privateWindowId!==null && worker) {
      try {
        await worker.command("Runtime.evaluate",{expression:`chrome.windows.remove(${privateWindowId})`,awaitPromise:true});
      } catch(error) {
        // The outer harness still terminates the owned browser and profile.
        console.error("TIMING_EXTENSION_WINDOW_CLEANUP",String(error));
      }
    }
    worker?.close();
    browser.close();
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}
