<#
  TEST ONLY. Nothing in production may call this, and val-projectos-tenant-principal1a pins that.

  Runs one command inside a real Windows pseudo console and types into it, as a person at a terminal would.

  WHY THIS EXISTS. `tenant receipt` is the only way out of TENANT_REGISTRY_NO_RECEIPT, and it reads the
  keyboard with a synchronous `readSync` on standard input. A test with an injected terminal cannot show
  that read works on Windows. This gives the real process a real console: `process.stdin.isTTY` is true
  because it is one. It uses the operating system's ConPTY through .NET, so it adds no dependency.

  It prints the console's output, then one line: EXIT:<code>.
#>
param(
  [Parameter(Mandatory = $true)][string]$CommandLine,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [Parameter(Mandatory = $true)][string]$WaitFor,
  [Parameter(Mandatory = $true)][string]$Typed,
  [int]$TimeoutMs = 60000
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public static class ConPtyProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct COORD { public short X; public short Y; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public IntPtr lpReserved; public IntPtr lpDesktop; public IntPtr lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, IntPtr attributes, int size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern int CreatePseudoConsole(COORD size, SafeFileHandle input, SafeFileHandle output, uint flags, out IntPtr console);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern void ClosePseudoConsole(IntPtr console);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION information);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint code);

  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  static readonly IntPtr PSEUDOCONSOLE = new IntPtr(0x00020016);

  public static int Run(string commandLine, string directory, string waitFor, string typed, int timeoutMs, out string output) {
    SafeFileHandle inputRead, inputWrite, outputRead, outputWrite;
    if (!CreatePipe(out inputRead, out inputWrite, IntPtr.Zero, 0)) throw new InvalidOperationException("input pipe");
    if (!CreatePipe(out outputRead, out outputWrite, IntPtr.Zero, 0)) throw new InvalidOperationException("output pipe");

    IntPtr console;
    int created = CreatePseudoConsole(new COORD { X = 400, Y = 60 }, inputRead, outputWrite, 0, out console);
    if (created != 0) throw new InvalidOperationException("CreatePseudoConsole " + created);
    inputRead.Dispose();
    outputWrite.Dispose();

    IntPtr size = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    IntPtr list = Marshal.AllocHGlobal(size);
    if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw new InvalidOperationException("attribute list");
    if (!UpdateProcThreadAttribute(list, 0, PSEUDOCONSOLE, console, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw new InvalidOperationException("attribute");

    STARTUPINFOEX startup = new STARTUPINFOEX();
    startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
    // With empty standard handles, so a redirected parent's pipes are not inherited and the console is used.
    startup.StartupInfo.dwFlags = 0x00000100;
    startup.lpAttributeList = list;
    PROCESS_INFORMATION information;
    if (!CreateProcessW(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, directory, ref startup, out information)) {
      throw new InvalidOperationException("CreateProcessW " + Marshal.GetLastWin32Error());
    }

    StringBuilder seen = new StringBuilder();
    object gate = new object();
    Thread reader = new Thread(() => {
      byte[] buffer = new byte[4096];
      using (FileStream stream = new FileStream(outputRead, FileAccess.Read)) {
        try {
          int read;
          while ((read = stream.Read(buffer, 0, buffer.Length)) > 0) {
            lock (gate) { seen.Append(Encoding.UTF8.GetString(buffer, 0, read)); }
          }
        } catch (IOException) { }
      }
    });
    reader.IsBackground = true;
    reader.Start();

    using (FileStream keyboard = new FileStream(inputWrite, FileAccess.Write)) {
      int waited = 0;
      bool asked = false;
      while (waited < timeoutMs && !asked) {
        // ConPTY opens by asking where the cursor is. A real terminal answers, and the child waits for it.
        lock (gate) { asked = seen.ToString().Contains(waitFor); }
        if (WaitForSingleObject(information.hProcess, 0) == 0) break;
        if (seen.Length > 0 && waited == 0) {
          byte[] position = Encoding.ASCII.GetBytes("\x1b[1;1R");
          keyboard.Write(position, 0, position.Length);
          keyboard.Flush();
        }
        Thread.Sleep(50);
        waited += 50;
      }
      if (asked) {
        byte[] keys = Encoding.UTF8.GetBytes(typed + "\r");
        keyboard.Write(keys, 0, keys.Length);
        keyboard.Flush();
      }
      if (WaitForSingleObject(information.hProcess, (uint)timeoutMs) != 0) TerminateProcess(information.hProcess, 124);
    }

    uint code;
    GetExitCodeProcess(information.hProcess, out code);
    ClosePseudoConsole(console);
    reader.Join(3000);
    lock (gate) { output = seen.ToString(); }
    return (int)code;
  }
}
'@

$output = ''
$code = [ConPtyProbe]::Run($CommandLine, $WorkingDirectory, $WaitFor, $Typed, $TimeoutMs, [ref]$output)
[Console]::Out.WriteLine($output)
[Console]::Out.WriteLine("EXIT:$code")
