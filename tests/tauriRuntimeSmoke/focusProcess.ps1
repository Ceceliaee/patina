param([int]$TargetProcessId, [switch]$VerifyPowerWindow)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TimingSmokeFocus {
    public delegate bool Visitor(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor visitor, IntPtr param);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int length);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder name, int length);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
}
'@
if ($VerifyPowerWindow) {
    $script:powerWindows = @()
    $visitor = [TimingSmokeFocus+Visitor]{ param($hwnd, $param)
        [uint32]$ownerId = 0
        [void][TimingSmokeFocus]::GetWindowThreadProcessId($hwnd, [ref]$ownerId)
        if ($ownerId -eq $TargetProcessId) {
            $class = New-Object Text.StringBuilder 256
            [void][TimingSmokeFocus]::GetClassName($hwnd, $class, 256)
            if ($class.ToString() -eq 'PatinaPowerWatcherWindow') { $script:powerWindows += [TimingSmokeFocus]::IsWindowVisible($hwnd) }
        }
        return $true
    }
    [void][TimingSmokeFocus]::EnumWindows($visitor, [IntPtr]::Zero)
    if ($script:powerWindows.Count -ne 1 -or $script:powerWindows[0]) { throw 'Power watcher must be one hidden top-level window eligible for broadcasts' }
    return
}
$targetWindow = (Get-Process -Id $TargetProcessId).MainWindowHandle
if ((Get-Process -Id $TargetProcessId).ProcessName -eq 'patina') {
    # MainWindowHandle may select the topmost widget. The tracking projection
    # intentionally preserves its predecessor while that control has focus.
    $script:mainWindows = @()
    $visitor = [TimingSmokeFocus+Visitor]{ param($hwnd, $param)
        [uint32]$ownerId = 0
        [void][TimingSmokeFocus]::GetWindowThreadProcessId($hwnd, [ref]$ownerId)
        if ($ownerId -eq $TargetProcessId) {
            $caption = New-Object Text.StringBuilder 256
            [void][TimingSmokeFocus]::GetWindowText($hwnd, $caption, 256)
            if ($caption.ToString() -eq 'Patina') { $script:mainWindows += $hwnd }
        }
        return $true
    }
    [void][TimingSmokeFocus]::EnumWindows($visitor, [IntPtr]::Zero)
    if ($script:mainWindows.Count -ne 1) { throw 'Expected exactly one isolated Patina main window' }
    $targetWindow = $script:mainWindows[0]
}
if ($targetWindow -eq [IntPtr]::Zero) { throw 'Test process has no window' }
$currentThread = [TimingSmokeFocus]::GetCurrentThreadId()
$foregroundThread = [TimingSmokeFocus]::GetWindowThreadProcessId([TimingSmokeFocus]::GetForegroundWindow(), [IntPtr]::Zero)
$targetThread = [TimingSmokeFocus]::GetWindowThreadProcessId($targetWindow, [IntPtr]::Zero)
$attachedThreads = @()
try {
    foreach ($thread in @($foregroundThread, $targetThread) | Select-Object -Unique) {
        if ($thread -ne 0 -and $thread -ne $currentThread -and [TimingSmokeFocus]::AttachThreadInput($currentThread, $thread, $true)) {
            $attachedThreads += $thread
        }
    }
    [void][TimingSmokeFocus]::ShowWindow($targetWindow, 9)
    [void][TimingSmokeFocus]::SetForegroundWindow($targetWindow)
} finally {
    foreach ($thread in $attachedThreads) { [void][TimingSmokeFocus]::AttachThreadInput($currentThread, $thread, $false) }
}
