<#
.SYNOPSIS
  Used by the Venue Router installer. You do not normally run this yourself.

.DESCRIPTION
  install    Writes config.json, sets the firewall rule, and registers and starts the "Venue Router" task.
  stop       Stops the running app so its files can be replaced. Also carries the saved setup over from an
             earlier copy that was set up with install-windows.ps1.
  uninstall  Stops the app and removes the task and the firewall rule. The saved setup is left alone.

  The app runs as the built-in Local Service account, which has no rights to the rest of the computer.
  The saved setup lives in C:\ProgramData\Venue Router.
#>
param(
  [ValidateSet('install', 'stop', 'uninstall')][string]$Action = 'install',
  [Parameter(Mandatory = $true)][string]$AppDir,
  [int]$Port = 0,
  [switch]$Network
)
$ErrorActionPreference = 'Stop'
$taskName = 'Venue Router'
$ruleName = 'Venue Router'
$AppDir = $AppDir.TrimEnd('\')
$data = Join-Path $env:ProgramData 'Venue Router'
$logs = Join-Path $data 'logs'
$configFile = Join-Path $data 'config.json'
$nodeExe = Join-Path $AppDir 'node.exe'
$setupFiles = 'venue.json', 'spaces.json', 'prefs.json', 'ports.json', 'auth.json', 'floor.json', 'floor-image.bin', 'normal-service.json'

function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false)) }

# The data folder: administrators and Windows itself in full, the app's account may change files, nobody else.
function Initialize-DataFolder {
  $new = -not (Test-Path $data)
  New-Item -ItemType Directory -Force $logs | Out-Null
  if ($new) {
    & icacls.exe $data /inheritance:r /grant '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not set permissions on $data." }
  }
}

function Read-SavedPort([string]$File) {
  try { $p = [int](Get-Content $File -Raw | ConvertFrom-Json).port; if ($p -gt 0 -and $p -lt 65536) { return $p } } catch {}
  return 0
}

# An earlier copy set up with install-windows.ps1 keeps its setup in its own folder. Bring it over once.
function Import-EarlierSetup {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) { return }
  $old = [string]($task.Actions | Select-Object -First 1).WorkingDirectory
  if (-not $old) { return }
  $old = $old.TrimEnd('\')
  if ($old -ieq $AppDir -or -not (Test-Path (Join-Path $old 'venue.json'))) { return }
  if (Test-Path (Join-Path $data 'venue.json')) { return }
  foreach ($name in $setupFiles) {
    $from = Join-Path $old $name
    if (Test-Path $from) { Copy-Item $from (Join-Path $data $name) -Force }
  }
  if (-not (Test-Path $configFile) -and (Test-Path (Join-Path $old 'config.json'))) { Copy-Item (Join-Path $old 'config.json') $configFile }
  Add-Content (Join-Path $logs 'install.log') "$(Get-Date -Format s)  Brought the saved setup over from $old"
}

function Stop-App {
  $ports = @(8787)
  $saved = Read-SavedPort $configFile
  if ($saved) { $ports += $saved }
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    $old = [string]($task.Actions | Select-Object -First 1).WorkingDirectory
    if ($old) { $p = Read-SavedPort (Join-Path $old 'config.json'); if ($p) { $ports += $p } }
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }
  # The app's own Node.js, wherever it is in its restart loop
  Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -ieq $nodeExe } | Stop-Process -Force -ErrorAction SilentlyContinue
  # An earlier copy that is still holding the port. Only a Node.js process is ever stopped.
  foreach ($p in ($ports | Select-Object -Unique)) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
      $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    }
  }
  Start-Sleep -Milliseconds 500
}

function Remove-Rule {
  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -DisplayName $ruleName }
}

try {
  if ($Action -eq 'stop') {
    Initialize-DataFolder
    Import-EarlierSetup
    Stop-App
    exit 0
  }

  if ($Action -eq 'uninstall') {
    Stop-App
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    Stop-App
    Remove-Rule
    exit 0
  }

  Initialize-DataFolder
  if ($Port -le 0) { $Port = Read-SavedPort $configFile }
  if ($Port -le 0) { $Port = 8787 }
  $bind = if ($Network) { '0.0.0.0' } else { '127.0.0.1' }
  Write-Utf8 $configFile ((@{ host = $bind; port = $Port } | ConvertTo-Json) + "`n")

  # Only this app's own Node.js is let through, only on its port, and never on a network Windows treats as Public.
  Remove-Rule
  if ($Network) {
    New-NetFirewallRule -DisplayName $ruleName -Description 'Lets other devices on the network open Venue Router.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Program $nodeExe -Profile Domain, Private | Out-Null
  }

  Write-Utf8 (Join-Path $AppDir 'Venue Router.url') "[InternetShortcut]`r`nURL=http://localhost:$Port/`r`n"

  $run = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\cmd.exe') -Argument ('/c ""' + (Join-Path $AppDir 'run.cmd') + '""') -WorkingDirectory $AppDir
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $taskName -Action $run -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs the Venue Router routing console.' -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Add-Content (Join-Path $logs 'install.log') "$(Get-Date -Format s)  Installed in $AppDir, port $Port, $(if ($Network) { 'open to the network' } else { 'this computer only' })"
  exit 0
} catch {
  try { New-Item -ItemType Directory -Force $logs | Out-Null; Add-Content (Join-Path $logs 'install.log') "$(Get-Date -Format s)  $Action failed: $($_.Exception.Message)" } catch {}
  Write-Error $_
  exit 1
}
