# TEST-ONLY native keyboard driver for the Phase-12 accessibility proof.
#
# The embedded WebDriver server implements Tab by dispatching a synthetic JavaScript KeyboardEvent
# to document.activeElement; it does NOT perform native focus traversal. So WebDriver Tab proves
# nothing about whether a keyboard-only owner can operate the surface, in either direction.
#
# This sends REAL OS input to the real ProjectOS window, so the WebView performs its own focus
# traversal exactly as it would for a person at the keyboard. WebDriver is then used only to OBSERVE
# where focus landed.
#
# Nothing here is part of ProjectOS: no production keyboard-control API is added, and this script is
# never invoked by the application.

param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [int]$Count = 1,
  [string]$Key = '{TAB}'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  // Windows refuses SetForegroundWindow to a process that does not already own the foreground.
  // Attaching to the current foreground window's input queue lifts that restriction for the call —
  // the documented way to raise another process's window, and detached again immediately.
  public static bool Raise(IntPtr target) {
    // Windows only grants foreground rights to a process that owns recent input. Tapping ALT gives
    // this process that claim, which is the documented way to make SetForegroundWindow reliable
    // from a test harness. Without it the call succeeds silently and the window never comes up.
    keybd_event(0x12, 0, 0, UIntPtr.Zero);        // ALT down
    keybd_event(0x12, 0, 2, UIntPtr.Zero);        // ALT up
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
    uint self = GetCurrentThreadId();
    bool attached = (fgThread != self) && AttachThreadInput(fgThread, self, true);
    ShowWindow(target, 9);
    bool ok = SetForegroundWindow(target);
    if (attached) AttachThreadInput(fgThread, self, false);
    return ok;
  }
}
"@

$proc = Get-Process -Id $ProcessId
$handle = $proc.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) {
  Write-Output 'NO_MAIN_WINDOW'
  exit 1
}

# Raise it. A background window would send the keys somewhere else entirely.
[Win]::Raise($handle) | Out-Null
Start-Sleep -Milliseconds 500

# Compare by OWNING PROCESS, not by handle: the foreground window may legitimately be a child of
# the app (the WebView2 host window), which is still the right target for keyboard input.
$fgPid = 0
[Win]::GetWindowThreadProcessId([Win]::GetForegroundWindow(), [ref]$fgPid) | Out-Null
if ($fgPid -ne $ProcessId) {
  Write-Output "NOT_FOREGROUND (foreground pid $fgPid, wanted $ProcessId)"
  exit 2
}

for ($i = 0; $i -lt $Count; $i++) {
  [System.Windows.Forms.SendKeys]::SendWait($Key)
  Start-Sleep -Milliseconds 140
}

Write-Output 'SENT'
