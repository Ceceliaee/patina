$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public sealed class PatinaRuntimeJob : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
    public BasicLimit Basic;
    public IoCounters Io;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
    public uint Size;
    public string Reserved, Desktop, Title;
    public uint X,Y,XSize,YSize,XCountChars,YCountChars,FillAttribute,Flags;
    public ushort ShowWindow, ReservedBytes;
    public IntPtr ReservedPointer, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInformation {
    public IntPtr Process, Thread;
    public uint ProcessId, ThreadId;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimit limits,uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application,System.Text.StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInformation info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr buffer,uint size,IntPtr returned);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  IntPtr job;
  System.Threading.Mutex desktop;
  readonly Dictionary<uint,IntPtr> processes = new Dictionary<uint,IntPtr>();
  public PatinaRuntimeJob() {
    job=CreateJobObject(IntPtr.Zero,null);
    if(job==IntPtr.Zero) throw new Win32Exception();
    var limits=new ExtendedLimit();
    limits.Basic.LimitFlags=0x2000; // Close of the sole job handle terminates every owned descendant.
    if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))) { Dispose(); throw new Win32Exception(); }
  }
  public uint Start(string executable,string arguments,string directory) {
    var startup=new StartupInfo(); startup.Size=(uint)Marshal.SizeOf(startup);
    // stdout is the supervisor protocol. Child logs, including partial lines,
    // must never interleave with its control replies.
    startup.Flags=0x100; startup.Input=IntPtr.Zero; startup.Output=GetStdHandle(-12); startup.Error=GetStdHandle(-12);
    ProcessInformation info;
    if(!CreateProcess(executable,new System.Text.StringBuilder("\""+executable+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,directory,ref startup,out info)) throw new Win32Exception(Marshal.GetLastWin32Error(),"Create owned process failed");
    try {
      // Assign while suspended: a child cannot escape between Start and assignment.
      if(!AssignProcessToJobObject(job,info.Process)) throw new Win32Exception(Marshal.GetLastWin32Error(),"Assign owned process failed");
      if(ResumeThread(info.Thread)==0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error(),"Resume owned process failed");
      processes.Add(info.ProcessId,info.Process);
      return info.ProcessId;
    } catch { TerminateProcess(info.Process,1); CloseHandle(info.Process); throw; }
    finally { CloseHandle(info.Thread); }
  }
  public long ExitCode(uint pid) {
    IntPtr process;
    if(!processes.TryGetValue(pid,out process)) throw new InvalidOperationException("Process is not owned by this run");
    uint code;
    if(!GetExitCodeProcess(process,out code)) throw new Win32Exception();
    return code==259 ? -1 : (long)code;
  }
  public void ClaimDesktop(string name) {
    if(desktop!=null) throw new InvalidOperationException("Desktop already claimed by this job");
    var candidate=new System.Threading.Mutex(false,name);
    bool acquired;
    try { acquired=candidate.WaitOne(0); }
    catch(System.Threading.AbandonedMutexException) { acquired=true; }
    if(!acquired) { candidate.Dispose(); throw new InvalidOperationException("Another runtime run owns this Windows desktop"); }
    desktop=candidate;
  }
  public int ActiveProcesses() {
    IntPtr buffer=Marshal.AllocHGlobal(48);
    try {
      if(!QueryInformationJobObject(job,1,buffer,48,IntPtr.Zero)) throw new Win32Exception();
      return Marshal.ReadInt32(buffer,40);
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  public void Stop() {
    if(!TerminateJobObject(job,1)) throw new Win32Exception();
    var timer=System.Diagnostics.Stopwatch.StartNew();
    while(ActiveProcesses()!=0) {
      if(timer.ElapsedMilliseconds>10000) throw new TimeoutException("Owned runtime job did not drain");
      System.Threading.Thread.Sleep(25);
    }
  }
  public void Dispose() {
    if(job!=IntPtr.Zero) { CloseHandle(job);job=IntPtr.Zero; }
    foreach(var process in processes.Values) CloseHandle(process);
    processes.Clear();
    if(desktop!=null) { desktop.ReleaseMutex(); desktop.Dispose(); desktop=null; }
  }
}
'@
$runtimeJob = [PatinaRuntimeJob]::new()
try {
  [Console]::WriteLine('PATINA_JOB_READY')
  while ($null -ne ($requestLine = [Console]::ReadLine())) {
    $request = $requestLine | ConvertFrom-Json
    try {
      switch ($request.op) {
        'start' { $result = $runtimeJob.Start($request.executable, $request.arguments, $request.directory) }
        'count' { $result = $runtimeJob.ActiveProcesses() }
        'exit' { $result = $runtimeJob.ExitCode($request.pid) }
        'desktop' { $runtimeJob.ClaimDesktop($request.name); $result=0 }
        'stop' { $runtimeJob.Stop(); $result = 0 }
        default { throw 'Unknown owned runtime job operation' }
      }
      [Console]::WriteLine('PATINA_JOB_REPLY ' + (@{ id=$request.id; result=$result } | ConvertTo-Json -Compress))
    } catch {
      [Console]::WriteLine('PATINA_JOB_REPLY ' + (@{ id=$request.id; error=$_.Exception.Message } | ConvertTo-Json -Compress))
    }
  }
} finally { $runtimeJob.Dispose() }
