import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface MiniNativeSample {
  // x/y/width/height describe the visible input region; canvas is the HWND.
  found: boolean; visible: boolean; x: number; y: number; width: number; height: number;
  canvas: { x: number; y: number; width: number; height: number };
  pixels: number[];
  foreground: string; mini: string; hitMini: boolean;
  inputTarget: string; inputRect: { Left: number; Top: number; Right: number; Bottom: number };
  workRect: { Left: number; Top: number; Right: number; Bottom: number }; moving: boolean;
  cursor: { X: number; Y: number };
  leftButtonDown: boolean;
}

// A separate input target lets the test distinguish a passive reveal from activation.
export function startMiniNativeProbe(processId: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class MiniProbe {
  public static System.Threading.Tasks.Task<string> ReadLineAsync() { return System.Threading.Tasks.Task.Run(() => Console.ReadLine()); }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetPhysicalCursorPos(int x,int y);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder info,uint length,out uint needed);
  [DllImport("user32.dll")] public static extern bool GetPhysicalCursorPos(out Point p);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern int GetWindowRgnBox(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h,IntPtr dc);
  [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr dc,int x,int y);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  public static uint[] SamplePixels(int x,int y) {
    var dc=GetDC(IntPtr.Zero); if(dc==IntPtr.Zero) throw new Exception("Cannot sample desktop compositor");
    try {
      var samples=new uint[60];
      for(int i=0;i<samples.Length;i++) {
        if(DwmFlush()!=0) throw new Exception("Desktop composition unavailable");
        samples[i]=GetPixel(dc,x,y); if(samples[i]==0xFFFFFFFF) throw new Exception("Cannot read composed pixel");
        if(i==0) Console.WriteLine("{\\"captureReady\\":true}");
        System.Threading.Thread.Sleep(8);
      }
      return samples;
    } finally { ReleaseDC(IntPtr.Zero,dc); }
  }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent,IntPtr child);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct GuiThreadInfo { public int cbSize; public uint flags; public IntPtr hwndActive,hwndFocus,hwndCapture,hwndMenuOwner,hwndMoveSize,hwndCaret; public Rect rcCaret; }
  public static IntPtr Find(uint pid,string title) { IntPtr found=IntPtr.Zero; EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);var s=new StringBuilder(200);GetWindowText(h,s,200);if(id==pid&&s.ToString()==title){found=h;return false;}return true;},IntPtr.Zero);return found; }
}
'@
[void][MiniProbe]::SetProcessDpiAwarenessContext([IntPtr](-4))
$desktop=[MiniProbe]::OpenInputDesktop(0,$false,1)
if ($desktop -eq [IntPtr]::Zero) { throw 'Input environment unavailable: no accessible input desktop' }
try {
  $desktopName=[Text.StringBuilder]::new(256); [uint32]$needed=0
  if (-not [MiniProbe]::GetUserObjectInformation($desktop,2,$desktopName,512,[ref]$needed) -or $desktopName.ToString() -ne 'Default') { throw 'Input environment unavailable: interactive Default desktop required' }
} finally { [void][MiniProbe]::CloseDesktop($desktop) }
$originalCursor = [System.Windows.Forms.Cursor]::Position
$originalForeground = [MiniProbe]::GetForegroundWindow()
$lastCursor=$null
$restoreInput=$false
$inputStarted=$false
$buttonDown=$false
if (([MiniProbe]::GetAsyncKeyState(1) -band 0x8000) -ne 0) { throw 'Input environment unavailable: left mouse button is already held' }
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Patina isolated mini input target'
$form.Width=320; $form.Height=180
$form.ShowInTaskbar=$false
$form.Show()
$backdropBounds=$form.Bounds; $backdropBorder=$form.FormBorderStyle; $backdropColor=$form.BackColor
function Focus-MiniProbeInput {
  $form.Show()
  $form.TopMost=$true
  $form.BringToFront()
  [System.Windows.Forms.Application]::DoEvents()
  [void][MiniProbe]::SetCursorPos([int]($form.Left+$form.Width/2),[int]($form.Top+$form.Height/2))
  [MiniProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  [MiniProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  [System.Windows.Forms.Application]::DoEvents()
  $form.TopMost=$false
  [void][MiniProbe]::SetForegroundWindow($form.Handle)
}
try {
  while ($true) {
    $read = [MiniProbe]::ReadLineAsync()
    while (-not $read.IsCompleted) { [System.Windows.Forms.Application]::DoEvents(); [System.Threading.Thread]::Sleep(20) }
    $line = $read.GetAwaiter().GetResult()
    if ($null -eq $line) { break }
    $request = $line | ConvertFrom-Json
    if ($request.op -eq 'quit') { $restoreInput=[bool]$request.restore; break }
    if ($request.op -ne 'up' -and $null -ne $lastCursor) {
      $current=New-Object MiniProbe+Point; [void][MiniProbe]::GetPhysicalCursorPos([ref]$current)
      if ($current.X -ne $lastCursor.X -or $current.Y -ne $lastCursor.Y) { throw "Input precondition changed: cursor moved outside this test; expected ($($lastCursor.X),$($lastCursor.Y)), observed ($($current.X),$($current.Y)); stopping injection" }
    }
    if ($inputStarted -and $request.op -in @('move','down','focus','fullscreen')) {
      $foreground=[MiniProbe]::GetForegroundWindow(); [uint32]$foregroundPid=0
      [void][MiniProbe]::GetWindowThreadProcessId($foreground,[ref]$foregroundPid)
      if ($foregroundPid -ne ${processId} -and $foreground -ne $form.Handle) { throw 'Input precondition changed: foreground belongs to another application; stopping injection' }
    }
    [void][MiniProbe]::SetThreadDpiAwarenessContext([IntPtr](-4))
    $miniHandle=[MiniProbe]::Find(${processId},'Patina Mini')
    if ($request.op -in @('lock','unlock','suspend','resume')) {
      $powerHandle=[MiniProbe]::Find(${processId},'PatinaPowerWatcherWindow')
      if ($powerHandle -eq [IntPtr]::Zero) { throw 'Missing isolated power observer' }
      $message=0x2B1; $value=7
      if ($request.op -eq 'unlock') { $value=8 }
      if ($request.op -eq 'suspend') { $message=0x218; $value=4 }
      if ($request.op -eq 'resume') { $message=0x218; $value=18 }
      [void][MiniProbe]::SendMessage($powerHandle,$message,[IntPtr]$value,[IntPtr]::Zero)
    }
    if ($request.op -eq 'native-close') { [void][MiniProbe]::SendMessage($miniHandle,0x112,[IntPtr]0xF060,[IntPtr]::Zero) }
    if ($request.op -eq 'move' -or $request.op -eq 'down' -or $request.op -eq 'up') { [void][MiniProbe]::SetPhysicalCursorPos([int]$request.x,[int]$request.y) }
    if ($request.op -eq 'down') { $buttonDown=$true; [MiniProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero) }
    if ($request.op -eq 'up') { [MiniProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero); $buttonDown=$false }
    if ($request.op -eq 'focus') { Focus-MiniProbeInput; $inputStarted=$true }
    if ($request.op -eq 'hide') { $form.Hide() }
    if ($request.op -eq 'fullscreen') {
      $form.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::None
      $form.Bounds=[System.Windows.Forms.Screen]::FromHandle($miniHandle).Bounds
      Focus-MiniProbeInput
    }
    if ($request.op -eq 'normal') { $form.Width=320; $form.Height=180 }
    if ($request.op -eq 'backdrop') {
      $bounds=New-Object MiniProbe+Rect
      [void][MiniProbe]::GetWindowRect($miniHandle,[ref]$bounds)
      $form.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::None
      $form.BackColor=[System.Drawing.Color]::White
      $form.Bounds=[System.Drawing.Rectangle]::new($bounds.Left-32,$bounds.Top-32,$bounds.Right-$bounds.Left+64,$bounds.Bottom-$bounds.Top+64)
      $form.Show(); $form.BringToFront()
    }
    if ($request.op -eq 'restore-backdrop') { $form.Bounds=$backdropBounds; $form.FormBorderStyle=$backdropBorder; $form.BackColor=$backdropColor }
    $pixelSamples=@()
    if ($request.op -eq 'capture') { $pixelSamples=[MiniProbe]::SamplePixels([int]$request.x,[int]$request.y) }
    [System.Windows.Forms.Application]::DoEvents()
    [void][MiniProbe]::SetThreadDpiAwarenessContext([IntPtr](-4))
    $rect=New-Object MiniProbe+Rect
    [void][MiniProbe]::GetWindowRect($miniHandle,[ref]$rect)
    $canvas=@{x=$rect.Left;y=$rect.Top;width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top)}
    $region=New-Object MiniProbe+Rect
    if ([MiniProbe]::GetWindowRgnBox($miniHandle,[ref]$region) -eq 2) {
      $rect.Right=$rect.Left+$region.Right; $rect.Bottom=$rect.Top+$region.Bottom
      $rect.Left+=$region.Left; $rect.Top+=$region.Top
    }
    $inputRect=New-Object MiniProbe+Rect
    [void][MiniProbe]::GetWindowRect($form.Handle,[ref]$inputRect)
    $point=New-Object MiniProbe+Point; $point.X=[int]$request.x; $point.Y=[int]$request.y
    $cursor=New-Object MiniProbe+Point; [void][MiniProbe]::GetPhysicalCursorPos([ref]$cursor)
    $lastCursor=$cursor
    $hit=[MiniProbe]::WindowFromPoint($point)
    $workRect=[System.Windows.Forms.Screen]::FromHandle($miniHandle).WorkingArea
    $gui=New-Object MiniProbe+GuiThreadInfo; $gui.cbSize=[System.Runtime.InteropServices.Marshal]::SizeOf($gui)
    [uint32]$miniProcess=0; $thread=[MiniProbe]::GetWindowThreadProcessId($miniHandle,[ref]$miniProcess)
    $moving=[MiniProbe]::GetGUIThreadInfo($thread,[ref]$gui) -and $gui.hwndMoveSize -eq $miniHandle -and $miniHandle -ne [IntPtr]::Zero
    @{pixels=$pixelSamples;canvas=$canvas;found=($miniHandle -ne [IntPtr]::Zero);visible=[MiniProbe]::IsWindowVisible($miniHandle);x=$rect.Left;y=$rect.Top;width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top);foreground=[MiniProbe]::GetForegroundWindow().ToString();mini=$miniHandle.ToString();inputTarget=$form.Handle.ToString();inputRect=$inputRect;workRect=@{Left=$workRect.Left;Top=$workRect.Top;Right=$workRect.Right;Bottom=$workRect.Bottom};moving=$moving;cursor=$cursor;leftButtonDown=(([MiniProbe]::GetAsyncKeyState(1) -band 0x8000) -ne 0);hitMini=($hit -eq $miniHandle -or [MiniProbe]::IsChild($miniHandle,$hit))} | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
  }
} finally {
  if ($buttonDown) { [MiniProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  $current=New-Object MiniProbe+Point; [void][MiniProbe]::GetPhysicalCursorPos([ref]$current)
  $foreground=[MiniProbe]::GetForegroundWindow(); [uint32]$foregroundPid=0
  [void][MiniProbe]::GetWindowThreadProcessId($foreground,[ref]$foregroundPid)
  $stillOwned=($foregroundPid -eq ${processId} -or $foreground -eq $form.Handle)
  $form.Dispose()
  if ($restoreInput -and $stillOwned -and $null -ne $lastCursor -and $current.X -eq $lastCursor.X -and $current.Y -eq $lastCursor.Y) {
    [void][MiniProbe]::SetCursorPos($originalCursor.X,$originalCursor.Y)
    [void][MiniProbe]::SetForegroundWindow($originalForeground)
  }
}
`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  let pending: { resolve: (sample: MiniNativeSample) => void; reject: (error: Error) => void; ready?: () => void } | null = null;
  let stderr = "";
  let closing: Promise<void> | null = null;
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  lines.on("line", (line) => {
    try {
      const value = JSON.parse(line) as MiniNativeSample & { captureReady?: boolean };
      if (value.captureReady) { pending?.ready?.(); return; }
      pending?.resolve(value); pending = null;
    }
    catch { /* Ignore PowerShell host startup output. */ }
  });
  child.on("exit", () => { pending?.reject(new Error(`Native mini probe exited: ${stderr}`)); pending = null; });
  child.on("error", error => { pending?.reject(error); pending = null; });
  child.stdin.on("error", error => { pending?.reject(error); pending = null; });
  const request = async (op: string, x = 0, y = 0, ready?: () => void) => new Promise<MiniNativeSample>((resolve, reject) => {
    if (signal?.aborted || closing || child.exitCode !== null) { reject(new Error(`Native probe is closed or cancelled: ${stderr}`)); return; }
    if (pending) { reject(new Error("Native probe operations must be sequential")); return; }
    const timer = setTimeout(() => { pending = null; reject(new Error(`Native probe timed out: ${stderr}`)); }, 20_000);
    pending = { resolve: (sample) => { clearTimeout(timer); resolve(sample); }, reject: (error) => { clearTimeout(timer); reject(error); }, ready };
    child.stdin.write(`${JSON.stringify({ op, x, y })}\n`);
  });
  const close = () => closing ??= (async () => {
      signal?.removeEventListener("abort", abort);
      pending?.reject(new Error("Native probe closed")); pending = null;
      child.stdin.end(`${JSON.stringify({ op: "quit", restore: !signal?.aborted })}\n`);
      await new Promise<void>((resolve, reject) => {
        if (child.exitCode !== null) { resolve(); return; }
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Native probe did not exit gracefully; input cleanup could not be confirmed"));
        }, 5_000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      lines.close();
  })();
  // The owner awaits the same close promise and preserves a cleanup failure.
  const abort = () => { void close().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const capture = (x: number, y: number) => {
    let started: () => void;
    let failed: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { started = resolve; failed = reject; });
    const result = request("capture", x, y, () => started());
    void result.catch(error => failed(error));
    return { ready, result };
  };
  return { request, capture, close };
}
