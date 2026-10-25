<#
  Windows Credential Manager backing store — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L2).

  The ONLY component in this capability that touches a real OS secret store. It is deliberately dumb:
  it stores, reads, deletes and enumerates generic credentials by target name. All policy (who may ask,
  for which project, under which session profile) lives above it in vault.cjs / the session router.

  SECRET-HANDLING RULES ENFORCED HERE
    - The secret value is NEVER a parameter and NEVER appears on a command line. `set` reads it from the
      environment variable PROJECTOS_CREDENTIAL_VALUE, which the calling process sets on the CHILD only.
    - `get` writes the value to stdout and nothing else — no echo, no transcript, no logging.
    - `list` returns target NAMES only. There is no code path that enumerates values.
    - The target name is validated against the same strict charset the Node layer enforces, so a
      malformed reference cannot reach the Win32 API.

  Exit codes: 0 = ok, 3 = not found, 1 = error (message on stderr).
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('set', 'get', 'delete', 'list', 'exists')]
  [string]$Action,

  [string]$Target = '',

  [string]$Prefix = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Same shape the Node layer enforces: ProjectOS/<project>/<environment>/<provider>/<credential>.
$targetPattern = '^ProjectOS(/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){4}$'

# Named $targetName, never $value: nothing in this script that is not the secret may be called "value".
function Assert-Target([string]$targetName) {
  if ($targetName -notmatch $targetPattern) {
    Write-Error "invalid credential target name"
    exit 1
  }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ProjectOSCredentialStore
{
    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredEnumerate(string filter, uint flags, out uint count, out IntPtr credentialsPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredFree")]
    private static extern void CredFree(IntPtr buffer);

    // Write (create or replace). The blob is UTF-16LE bytes of the value; the value is zeroed from the
    // unmanaged buffer before this method returns so it does not linger in process memory.
    public static void Write(string target, string userName, string value)
    {
        byte[] blob = Encoding.Unicode.GetBytes(value);
        IntPtr blobPtr = Marshal.AllocHGlobal(blob.Length);
        IntPtr targetPtr = Marshal.StringToCoTaskMemUni(target);
        IntPtr userPtr = Marshal.StringToCoTaskMemUni(userName);
        try
        {
            Marshal.Copy(blob, 0, blobPtr, blob.Length);
            CREDENTIAL cred = new CREDENTIAL();
            cred.Type = CRED_TYPE_GENERIC;
            cred.TargetName = targetPtr;
            cred.CredentialBlobSize = (uint)blob.Length;
            cred.CredentialBlob = blobPtr;
            cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
            cred.UserName = userPtr;
            if (!CredWrite(ref cred, 0))
            {
                throw new InvalidOperationException("CredWrite failed with " + Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            Array.Clear(blob, 0, blob.Length);
            for (int i = 0; i < blob.Length; i++) { Marshal.WriteByte(blobPtr, i, 0); }
            Marshal.FreeHGlobal(blobPtr);
            Marshal.FreeCoTaskMem(targetPtr);
            Marshal.FreeCoTaskMem(userPtr);
        }
    }

    // Read. Returns null when the target does not exist.
    public static string Read(string target)
    {
        IntPtr ptr;
        if (!CredRead(target, CRED_TYPE_GENERIC, 0, out ptr)) { return null; }
        try
        {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            if (cred.CredentialBlobSize == 0) { return string.Empty; }
            byte[] blob = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, blob, 0, (int)cred.CredentialBlobSize);
            string value = Encoding.Unicode.GetString(blob);
            Array.Clear(blob, 0, blob.Length);
            return value;
        }
        finally { CredFree(ptr); }
    }

    public static bool Delete(string target)
    {
        return CredDelete(target, CRED_TYPE_GENERIC, 0);
    }

    // Enumerate target NAMES matching a filter. Values are never touched on this path.
    public static string[] Enumerate(string filter)
    {
        uint count;
        IntPtr ptr;
        if (!CredEnumerate(filter, 0, out count, out ptr))
        {
            int err = Marshal.GetLastWin32Error();
            if (err == 1168) { return new string[0]; } // ERROR_NOT_FOUND — an empty store is not an error
            throw new InvalidOperationException("CredEnumerate failed with " + err);
        }
        try
        {
            string[] names = new string[count];
            for (int i = 0; i < count; i++)
            {
                IntPtr entry = Marshal.ReadIntPtr(ptr, i * IntPtr.Size);
                CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(entry, typeof(CREDENTIAL));
                names[i] = Marshal.PtrToStringUni(cred.TargetName);
            }
            return names;
        }
        finally { CredFree(ptr); }
    }
}
'@

switch ($Action) {
  'set' {
    Assert-Target $Target
    $value = [Environment]::GetEnvironmentVariable('PROJECTOS_CREDENTIAL_VALUE')
    if ([string]::IsNullOrEmpty($value)) {
      Write-Error "no credential value supplied on the environment channel"
      exit 1
    }
    [ProjectOSCredentialStore]::Write($Target, 'ProjectOS', $value)
    exit 0
  }
  'get' {
    Assert-Target $Target
    $value = [ProjectOSCredentialStore]::Read($Target)
    if ($null -eq $value) { exit 3 }
    [Console]::Out.Write($value)
    exit 0
  }
  'exists' {
    Assert-Target $Target
    $value = [ProjectOSCredentialStore]::Read($Target)
    if ($null -eq $value) { exit 3 }
    exit 0
  }
  'delete' {
    Assert-Target $Target
    if ([ProjectOSCredentialStore]::Delete($Target)) { exit 0 }
    exit 3
  }
  'list' {
    # Names only. The prefix is a WHOLE-SEGMENT reference prefix: it must either be the complete target
    # name, or the target must continue after it at a '/' boundary. That is deliberate (see the boundary
    # re-filter below) and is the contract the CLI, the docs and the Node layer all describe.
    if ($Prefix -ne '' -and $Prefix -notmatch '^ProjectOS(/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,4}$') {
      Write-Error "CREDENTIAL PREFIX FORMAT INVALID: a listing prefix must be a whole-segment path inside the ProjectOS namespace"
      exit 1
    }
    $filter = 'ProjectOS/*'
    if ($Prefix -ne '') { $filter = $Prefix + '*' }
    # CredEnumerate's filter is a plain wildcard with no notion of a '/' boundary, so 'ProjectOS/poly*'
    # also matches 'ProjectOS/polygo2/...'. Re-filter on the segment boundary here so a listing scoped to
    # one project can never disclose a sibling project's credential inventory.
    $boundary = $Prefix
    if ($boundary -ne '' -and -not $boundary.EndsWith('/')) { $boundary = $boundary + '/' }
    # Ordinal, case-SENSITIVE throughout. PowerShell's -eq/-ne are case-insensitive while .StartsWith is
    # case-sensitive by default; mixing them would let a listing scoped to 'polygo' disclose a distinct
    # project named 'PolyGo', because the reference charset treats case as significant.
    $matched = New-Object System.Collections.Generic.List[string]
    $partialSegmentHits = 0
    foreach ($name in [ProjectOSCredentialStore]::Enumerate($filter)) {
      if ($name -cnotmatch $targetPattern) { continue }
      if ($Prefix -eq '' -or [String]::Equals($name, $Prefix, [StringComparison]::Ordinal) -or $name.StartsWith($boundary, [StringComparison]::Ordinal)) {
        $matched.Add($name)
      }
      elseif ($name.StartsWith($Prefix, [StringComparison]::Ordinal)) {
        # Begins with the caller's literal string but NOT at a '/' boundary: the caller supplied a partial
        # segment (e.g. 'ProjectOS/synthetic-' against 'ProjectOS/synthetic-x/...'). Counting it is all we
        # do - the sibling's name is never disclosed.
        $partialSegmentHits++
      }
    }
    # A success-empty answer would read as 'this project has no credentials' when entries exist and only
    # the prefix was mis-shaped. Fail closed: silent empty success is prohibited.
    if ($matched.Count -eq 0 -and $partialSegmentHits -gt 0) {
      Write-Error "CREDENTIAL PREFIX FORMAT INVALID: partial segment; entries exist that continue it within a segment. Supply a whole-segment prefix."
      exit 1
    }
    foreach ($name in $matched) { [Console]::Out.WriteLine($name) }
    exit 0
  }
}
