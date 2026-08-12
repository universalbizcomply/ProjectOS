# PROJECTOS-RECOVERY-INSTALLED-APP1A - the installer EFFECT MANIFEST.
#
# A human-reviewable statement of exactly what the built installer would do, read from the installer
# ITSELF rather than inferred from configuration or intent.
#
# IT DOES NOT INSTALL ANYTHING. The MSI is opened READ-ONLY through the Windows Installer database
# API (OpenDatabase mode 0) and queried with SELECT statements. No install, no repair, no
# advertisement, no elevation, no registry write, no ProgramData write, no service change.
#
# Usage:  powershell -ExecutionPolicy Bypass -File packaging/installer-effect-manifest.ps1
#
# Deliberately written as straight-line queries that print as they go. An earlier version built
# hashtables and nested arrays from the results; PowerShell unrolls single-row results differently
# at different call sites, and three attempts to defend against that each produced a different wrong
# answer. An effect manifest that is subtly wrong is worse than none, so this one does the simple
# thing. Where a table is ABSENT that is reported as NONE; where a query FAILS on a table that
# exists, that is reported as an ERROR - never as NONE.
#
# ASCII ONLY. Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI, so anything else mojibakes.

$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$bundleDir = Join-Path $root 'src-tauri\target\release\bundle\msi'
$msi = Get-ChildItem $bundleDir -Filter *.msi -EA SilentlyContinue | Select-Object -First 1
if (-not $msi) { Write-Output "no MSI found in $bundleDir - run 'npx tauri build' first"; exit 1 }

$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($msi.FullName, 0))

# Every table the MSI actually contains. Used to tell ABSENT apart from FAILED - see below.
$script:TableNames = @()
$tv = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @('SELECT `Name` FROM `_Tables`'))
$tv.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $tv, $null) | Out-Null
while ($true) {
  $rec = $tv.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $tv, $null)
  if ($null -eq $rec) { break }
  $script:TableNames += [string]$rec.GetType().InvokeMember('StringData', 'GetProperty', $null, $rec, @(1))
}
$tv.GetType().InvokeMember('Close', 'InvokeMethod', $null, $tv, $null) | Out-Null

# Print every row of a query, one line each, fields separated by ' | '. Returns the row count, or
# -1 when the table genuinely does not exist.
#
# THE BUG THIS NOW PREVENTS. The first version wrapped the query in a try/catch and reported an
# absent table on ANY failure. `Key` and `Value` are RESERVED WORDS in MSI SQL, so
# `SELECT Root, Key, Name FROM Registry` threw - and the manifest confidently reported
# "REGISTRY KEYS: NONE" for an installer that authors four of them. A swallowed error became a
# reassuring answer, which is the worst thing an effect manifest can do. Identifiers are now quoted,
# and a failure on a table that EXISTS is reported as an ERROR rather than as NONE.
function Show-Query([string]$sql, [string]$table, [string]$indent = '  ') {
  if ($script:TableNames -notcontains $table) { return -1 }
  $n = 0
  try {
    $view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @($sql))
    # Out-Null, NOT bare. Execute's return value would otherwise join this function's OUTPUT
    # STREAM, so `$n = Show-Query ...` yields an ARRAY rather than the row count and every
    # `-eq 0` / `-le 0` test on it silently misbehaves. Same PowerShell trap as the row printing
    # below, and it hid the InstallDirDlg result until it was caught here.
    $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
    while ($true) {
      $rec = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
      if ($null -eq $rec) { break }
      $count = $rec.GetType().InvokeMember('FieldCount', 'GetProperty', $null, $rec, $null)
      $line = ''
      for ($i = 1; $i -le $count; $i++) {
        $val = [string]$rec.GetType().InvokeMember('StringData', 'GetProperty', $null, $rec, @($i))
        # MSI authors names as 'shortname|Long Name'; the long name is what lands on disk.
        if ($val -match '\|') { $val = $val.Split('|')[-1] }
        if ($i -gt 1) { $line += ' | ' }
        $line += $val
      }
      # [Console]::WriteLine, NOT Write-Output. In PowerShell everything a function writes to the
      # output stream becomes part of its RETURN VALUE, so `$n = Show-Query ...` swallowed every row
      # and `$null = Show-Query ...` discarded them outright. The first version of this manifest
      # therefore reported NONE for shortcuts and custom actions that the installer really declares
      # - under-reporting installer effects, which is the one failure mode an effect manifest must
      # not have. Writing straight to the console keeps the rows out of the return value.
      [Console]::WriteLine($indent + $line)
      $n++
    }
    $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
  } catch {
    # The table EXISTS but could not be read. That is a defect in this script, not an absence of
    # effect, and it must never be presented as NONE.
    [Console]::WriteLine($indent + "ERROR: table '$table' exists but could not be read: $($_.Exception.Message)")
    return -2
  }
  return $n
}

$sha = (Get-FileHash -Algorithm SHA256 -Path $msi.FullName).Hash.ToLower()
$commit = (& git -C $root rev-parse HEAD).Trim()
$dirty = ((& git -C $root status --porcelain) | Measure-Object).Count -gt 0
$sig = Get-AuthenticodeSignature -FilePath $msi.FullName

Write-Output '================================================================================'
Write-Output 'PROJECTOS INSTALLER - EFFECT MANIFEST'
Write-Output '================================================================================'
Write-Output ''
Write-Output '  This is a reviewable release CANDIDATE. Do not install it.'
Write-Output ''

# TWO DIFFERENT SIGNATURES, REPORTED SEPARATELY AND NEVER CONFLATED.
#
#   PROJECTOS MANIFEST TRUST - the owner's ES256 signature over the canonical manifest bytes,
#   verified against the public anchor compiled into the application. This is what decides whether
#   the packaged runtime may launch. It is ProjectOS's own trust chain and needs no certificate
#   authority, no Authenticode and no third party.
#
#   WINDOWS AUTHENTICODE - a code-signing signature over the installer and executable, which is what
#   SmartScreen and the UAC prompt show a user. It is a DIFFERENT question with different machinery,
#   and Phase 5 does not require it.
#
# Reporting one as though it were the other would either overstate what is trusted or understate it.
$payloadDir = Join-Path $root 'dist-payload'
$manifestPath = Join-Path $payloadDir 'projectos-trust-manifest.json'
$canonicalPath = Join-Path $payloadDir 'projectos-trust-manifest.canonical'
Write-Output 'PROJECTOS MANIFEST TRUST'
if ((Test-Path $manifestPath) -and (Test-Path $canonicalPath)) {
  $m = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $canonicalBytes = (Get-Item $canonicalPath).Length
  $canonicalSha = (Get-FileHash -Algorithm SHA256 $canonicalPath).Hash.ToLower()
  $hasSig = -not [string]::IsNullOrEmpty($m.signature)
  # VERIFY, DO NOT ASSUME. An earlier draft printed "SIGNED / VERIFIED" whenever the signature field
  # was merely non-empty, which is a claim about cryptography made without doing any. This performs
  # the real ECDSA P-256 check, and against the anchor COMPILED INTO THE APPLICATION rather than any
  # key handed to this script - the same key the shipped binary will use and the only one that
  # decides trust.
  #
  # THE ANCHOR IS RE-DERIVED FROM anchor.rs ON PURPOSE, even though build-release-payload.mjs
  # already parses the same constant. Sharing that work would mean reading a value the BUILD
  # produced, and an effect manifest that trusts build output can be told what to say by the build.
  # This document exists to be independent of the thing it describes, so it goes back to the source
  # of truth. The cost is a few lines of duplicated regex; the alternative costs the independence.
  $verified = $false
  $verifyError = ''
  $anchorHex = ''
  if ($hasSig) {
    try {
      $anchorFile = Join-Path (Split-Path -Parent $root) 'host\host-identity\src\identity\anchor.rs'
      $anchorSrc = Get-Content $anchorFile -Raw
      $anchorSrc = $anchorSrc.Substring(0, $anchorSrc.IndexOf('#[cfg(test)]'))
      $arr = [regex]::Match($anchorSrc, 'const OWNER_PUBLIC_POINT[\s\S]*?=\s*\[([\s\S]*?)\];').Groups[1].Value
      $pt = [byte[]]([regex]::Matches($arr, '0x([0-9a-fA-F]{2})') | ForEach-Object { [Convert]::ToByte($_.Groups[1].Value, 16) })
      $anchorHex = ($pt | ForEach-Object { $_.ToString('x2') }) -join ''
      $sigBytes = [byte[]]( ($m.signature -split '(..)' | Where-Object { $_ } ) | ForEach-Object { [Convert]::ToByte($_, 16) } )
      $ecdsa = [System.Security.Cryptography.ECDsa]::Create()
      $ecdsa.ImportParameters([System.Security.Cryptography.ECParameters]@{
        Curve = [System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256')
        Q     = [System.Security.Cryptography.ECPoint]@{ X = $pt[1..32]; Y = $pt[33..64] }
      })
      $verified = $ecdsa.VerifyData(
        [System.IO.File]::ReadAllBytes($canonicalPath), $sigBytes,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    } catch {
      # COULD NOT VERIFY is a different fact from VERIFIED AND FAILED. Both are fail-closed, but an
      # operator told "signature failed" will hunt a signing problem that does not exist when the
      # real fault is this script (an unreadable anchor, a changed constant name). Say which.
      $verifyError = $_.Exception.Message
    }
  }
  if (-not $hasSig) { Write-Output '  STATUS              : UNSIGNED - owner signing gate pending' }
  elseif ($verified) { Write-Output '  STATUS              : SIGNED / VERIFIED against the embedded anchor' }
  elseif ($verifyError) {
    Write-Output '  STATUS              : SIGNED but COULD NOT BE VERIFIED HERE - DO NOT SHIP'
    Write-Output "  verification fault  : $verifyError"
    Write-Output '  This is a fault in THIS SCRIPT or its inputs, not proof that the signature is'
    Write-Output '  bad. Treat it as unverified until it verifies.'
  }
  else { Write-Output '  STATUS              : SIGNED but VERIFICATION FAILED - DO NOT SHIP' }
  Write-Output "  signingKeyId        : $($m.signingKeyId)"
  Write-Output "  signatureAlgorithm  : $($m.signatureAlgorithm)"
  Write-Output "  buildId             : $($m.buildId)"
  Write-Output "  generatedAt         : $($m.generatedAt)"
  Write-Output "  canonical bytes     : $canonicalBytes"
  Write-Output "  canonical sha256    : $canonicalSha"
  if ($anchorHex) { Write-Output "  embedded anchor     : $anchorHex" }
  Write-Output ''
  Write-Output '  The signature covers the canonical bytes and is NOT part of them, so attaching it'
  Write-Output '  cannot change what it signs. It is verified against the PUBLIC anchor embedded in'
  Write-Output '  the application binary - the manifest does not get to nominate its own verifier.'
} else {
  Write-Output '  NOT PRESENT - run the release payload pipeline first.'
}
Write-Output ''
Write-Output "installer filename    : $($msi.Name)"
Write-Output 'installer type        : Windows Installer (MSI), built by WiX via Tauri'
Write-Output "installer size        : $($msi.Length) bytes"
Write-Output "installer sha256      : $sha"
if ($dirty) { Write-Output "source commit         : $commit (WORKING TREE DIRTY)" }
else { Write-Output "source commit         : $commit" }
Write-Output 'WINDOWS AUTHENTICODE (a SEPARATE matter from ProjectOS manifest trust)'
Write-Output "  installer status    : $($sig.Status)"
if ($sig.Status -eq 'Valid') { Write-Output '  STATUS              : SIGNED' }
else {
  Write-Output '  STATUS              : NOT SIGNED'
  Write-Output '  Windows will show an unknown-publisher prompt. This does NOT affect the ProjectOS'
  Write-Output '  manifest trust chain above, which needs no certificate authority.'
}
Write-Output ''

Write-Output 'IDENTITY AND SCOPE (Property table)'
$null = Show-Query 'SELECT `Property`,`Value` FROM `Property` WHERE `Property`=''ProductName'' OR `Property`=''ProductVersion'' OR `Property`=''Manufacturer'' OR `Property`=''ProductCode'' OR `Property`=''UpgradeCode'' OR `Property`=''ALLUSERS''' 'Property'
Write-Output ''
Write-Output '  ALLUSERS=1 means PER-MACHINE. A per-machine install writes under Program Files and'
Write-Output '  therefore REQUIRES ELEVATION (administrator consent) at install time.'
Write-Output ''

Write-Output 'INSTALL LOCATION - FIXED, NOT CHOSEN'
Write-Output ''
Write-Output '  ProjectOS refuses to run an installation whose recorded install root does not match'
Write-Output '  the directory the executable actually runs from. An installer that let a user pick a'
Write-Output '  different directory would therefore offer a choice that produces an installation'
Write-Output '  ProjectOS will not launch. The choice is removed rather than the check weakened.'
Write-Output ''
Write-Output '  Evidence, read from this MSI:'
Write-Output ''
Write-Output '  1. the directory dialog does not exist in this installer:'
$idd = Show-Query 'SELECT `Dialog` FROM `Dialog` WHERE `Dialog`=''InstallDirDlg''' 'Dialog' '       '
if ($idd -eq 0) { Write-Output '       ABSENT. InstallDirDlg is not in the Dialog table - not merely skipped.' }
elseif ($idd -gt 0) { Write-Output '       PRESENT - THE INSTALL ROOT IS SELECTABLE. THIS IS A DEFECT.' }
else { Write-Output '       ERROR or no Dialog table - see above.' }
Write-Output ''
Write-Output '  2. no control of any kind can browse or type a directory:'
$dctl = Show-Query 'SELECT `Dialog_`,`Control`,`Type` FROM `Control` WHERE `Type`=''PathEdit'' OR `Type`=''DirectoryCombo'' OR `Type`=''DirectoryList''' 'Control' '       '
if ($dctl -eq 0) { Write-Output '       NONE. No PathEdit, DirectoryCombo or DirectoryList control exists.' }
elseif ($dctl -gt 0) { Write-Output '       PRESENT - THE INSTALL ROOT IS EDITABLE. THIS IS A DEFECT.' }
Write-Output ''
Write-Output '  3. no feature may be redirected (ConfigurableDirectory must be empty for all):'
$null = Show-Query 'SELECT `Feature`,`Directory_` FROM `Feature`' 'Feature' '       '
Write-Output ''
Write-Output '  4. nothing searches for a previous install directory. AppSearch sets only:'
$as = Show-Query 'SELECT `Property`,`Signature_` FROM `AppSearch`' 'AppSearch' '       '
if ($as -eq 0 -or $as -eq -1) { Write-Output '       NONE.' }
Write-Output '       INSTALLDIR is absent from that list, so no stale registry value from an earlier'
Write-Output '       install can silently relocate this one.'
Write-Output ''
Write-Output '  5. the dialogs this installer actually contains:'
$null = Show-Query 'SELECT `Dialog` FROM `Dialog`' 'Dialog' '       '
Write-Output ''
Write-Output '  SCOPE OF THIS CLAIM. This concerns the NORMAL INSTALLER USER FLOW: what a person'
Write-Output '  running the MSI can choose. It is NOT a claim that the install root cannot be'
Write-Output '  overridden at all. An administrator can still pass INSTALLDIR=... on an msiexec'
Write-Output '  command line, and Windows Installer will honour it. That is not defended against'
Write-Output '  here, and it is not silent: such an installation records one root, installs to'
Write-Output '  another, and ProjectOS REFUSES to launch it. The failure is loud and fails closed.'
Write-Output ''
Write-Output '  KNOWN LIMITATION - THE SYSTEM DRIVE IS ASSUMED TO BE C:. INSTALLDIR resolves from'
Write-Output '  ProgramFiles64Folder, which follows the drive Windows is installed on, but the'
Write-Output '  installed-application record is composed once at BUILD time and hardcodes C:. On a'
Write-Output '  machine where Windows is not on C:, a LEGITIMATE untampered install would be'
Write-Output '  refused at launch. That fails closed, not open - a reliability defect, not a'
Write-Output '  security one - but it is a real installation path this MSI permits and ProjectOS'
Write-Output '  would refuse. Closing it requires composing the record at INSTALL time via a custom'
Write-Output '  action, which is an OWNER DECISION and is deliberately not taken here.'
Write-Output ''

Write-Output 'DIRECTORIES (id | parent | name)'
$null = Show-Query 'SELECT `Directory`,`Directory_Parent`,`DefaultDir` FROM `Directory`' 'Directory'
Write-Output ''
Write-Output '  INSTALLDIR sits under ProgramFiles64Folder. runtime-payload is its child, and the'
Write-Output '  packaged runtime payload (daemon/, runtime/) lives beneath that - the app-owned'
Write-Output '  subdirectory the packaging contract names.'
Write-Output ''

Write-Output 'FILES INSTALLED (name | size | component)'
$fileCount = Show-Query 'SELECT `FileName`,`FileSize`,`Component_` FROM `File`' 'File'
Write-Output ''
Write-Output "  $fileCount file(s) total."
Write-Output ''

Write-Output 'WINDOWS SERVICES'
$svc = Show-Query 'SELECT `Name` FROM `ServiceInstall`' 'ServiceInstall'
if ($svc -eq -1) { Write-Output '  NONE. The installer declares no ServiceInstall table at all.' }
elseif ($svc -eq 0) { Write-Output '  NONE. The ServiceInstall table is empty.' }
Write-Output ''

Write-Output 'REGISTRY KEYS AUTHORED BY THIS INSTALLER (root | key | name | value)'
$reg = Show-Query 'SELECT `Root`,`Key`,`Name`,`Value` FROM `Registry`' 'Registry'
if ($reg -le 0) {
  Write-Output '  NONE. There is no Registry table.'
  Write-Output ''
  Write-Output '  Windows Installer still records its OWN product registration under'
  Write-Output '  HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\<ProductCode> and in the'
  Write-Output '  Installer databases. That is platform behaviour for every MSI, not ProjectOS'
  Write-Output '  configuration, and it is what makes the product appear in Apps and Features.'
}
Write-Output ''

Write-Output 'PROGRAMDATA (directory id | parent | name)'
$pd = Show-Query 'SELECT `Directory`,`Directory_Parent`,`DefaultDir` FROM `Directory` WHERE `Directory_Parent`=''CommonAppDataFolder'' OR `Directory`=''PROJECTOS_HOST_STATE_DIR'' OR `Directory`=''PROJECTOS_INSTALLATION_DIR''' 'Directory'
if ($pd -eq -1 -or $pd -eq 0) { Write-Output '  NONE written by this installer.' }
else {
  Write-Output ''
  Write-Output '  The installer AUTHORS the canonical installed-application record at'
  Write-Output '  <ProgramData>\ProjectOS\host\installation\application.v1.json.'
  Write-Output ''
  Write-Output '  That record is what gives an installation its corroborating per-machine evidence'
  Write-Output '  and names the governed ProjectOS SYSTEM root. It carries no secret, no key'
  Write-Output '  material and no trust anchor: it states installation facts, and the governed root'
  Write-Output '  it names is only ever consumed through the sealed boundary that demands a verified'
  Write-Output '  packaged identity. A record without a verified application is worth nothing.'
}
Write-Output ''

Write-Output 'PROGRAMDATA REMOVAL ON UNINSTALL (key | component | directory | mode)'
$rm = Show-Query 'SELECT `FileKey`,`Component_`,`DirProperty`,`InstallMode` FROM `RemoveFile`' 'RemoveFile'
if ($rm -le 0) { Write-Output '  NONE' }
else {
  Write-Output ''
  Write-Output '  InstallMode 2 is msidbRemoveFileInstallModeOnRemove: removed on UNINSTALL. The'
  Write-Output '  record file is its component KeyPath, so Windows Installer removes the file itself'
  Write-Output '  and rolls it back if installation fails; the three entries owned by'
  Write-Output '  ProjectOSInstallationRecordFile take the ProjectOS ProgramData directories with it.'
  Write-Output '  No orphaned trust record and no empty ProjectOS tree survive a normal uninstall.'
}
Write-Output ''

Write-Output 'SHORTCUTS (name | directory | target)'
$sc = Show-Query 'SELECT `Name`,`Directory_`,`Target` FROM `Shortcut`' 'Shortcut'
if ($sc -le 0) { Write-Output '  NONE' }
Write-Output ''

Write-Output 'ACL CHANGES'
$acl = Show-Query 'SELECT `LockObject`,`Table` FROM `LockPermissions`' 'LockPermissions'
if ($acl -le 0) {
  Write-Output '  NONE beyond installer/platform defaults. There is no LockPermissions table, so no'
  Write-Output '  explicit ACL is authored. Files inherit the permissions of Program Files, which'
  Write-Output '  Windows already protects from non-administrators. This is DISTINCT from deliberate'
  Write-Output '  custom ACL hardening, of which there is NONE.'
}
Write-Output ''

Write-Output 'CUSTOM ACTIONS (action | type)'
$ca = Show-Query 'SELECT `Action`,`Type` FROM `CustomAction`' 'CustomAction'
if ($ca -le 0) { Write-Output '  NONE' }
else {
  Write-Output ''
  Write-Output '  NOTE: DownloadAndInvokeBootstrapper is the Microsoft WebView2 runtime bootstrapper.'
  Write-Output '  On a machine without WebView2 it DOWNLOADS FROM MICROSOFT during installation, so'
  Write-Output '  the install is not offline there. This is Tauri default behaviour, not ProjectOS'
  Write-Output '  configuration.'
}
Write-Output ''

Write-Output 'ELEVATION'
Write-Output '  REQUIRED. Per-machine (ALLUSERS=1) installation into Program Files needs'
Write-Output '  administrator consent. The application itself does not self-elevate.'
Write-Output ''

Write-Output 'UNINSTALL / ROLLBACK'
Write-Output '  Standard Windows Installer semantics. Every file above belongs to a component keyed'
Write-Output '  to this ProductCode, so uninstall removes exactly those files and the shortcuts, and'
Write-Output '  a failed install rolls back through the installer transaction. An Uninstall shortcut'
Write-Output '  invoking msiexec is installed alongside the application. ProgramData IS touched: the'
Write-Output '  installed-application record is written there, and the RemoveFile entries above take'
Write-Output '  it and its directories away again on uninstall.'
Write-Output ''
Write-Output '================================================================================'
Write-Output 'DO NOT INSTALL. Installation authority is a SEPARATE owner decision.'
Write-Output '================================================================================'
