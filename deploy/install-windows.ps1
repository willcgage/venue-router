#Requires -Version 5.1
<#
.SYNOPSIS
  Sets Venue Router up to run by itself on a Windows 10 or 11 computer.

.DESCRIPTION
  Installs the libraries the app needs, writes config.json so other devices can reach it,
  and registers a scheduled task called "Venue Router" that starts it and restarts it if it stops.

  By default the task runs as the person running this script, whenever they sign in.
  That needs no administrator rights.

.PARAMETER AtStartup
  Start when Windows starts, before anyone signs in, running as the SYSTEM account.
  Needs an administrator PowerShell. Use this on a computer nobody signs in to.

.PARAMETER OpenFirewall
  Also add a Windows Firewall rule letting other devices on Domain and Private networks reach the app.
  Needs an administrator PowerShell. Without it, Windows may block other devices until you allow it yourself.

.PARAMETER LocalOnly
  Only reachable from this computer. Use on a booth PC that nobody else connects to.

.PARAMETER Port
  The port to listen on. Default 8787.

.PARAMETER Uninstall
  Stop and remove the scheduled task, and the firewall rule if this script added one. Leaves your setup files alone.

.EXAMPLE
  .\install-windows.ps1
.EXAMPLE
  .\install-windows.ps1 -AtStartup -OpenFirewall
.EXAMPLE
  .\install-windows.ps1 -Uninstall
#>
param(
  [switch]$AtStartup,
  [switch]$OpenFirewall,
  [switch]$LocalOnly,
  [int]$Port = 8787,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$taskName = 'Venue Router'
$ruleName = 'Venue Router'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($Uninstall) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed the '$taskName' task."
  } else { Write-Host "There was no '$taskName' task to remove." }
  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    if ($isAdmin) { Remove-NetFirewallRule -DisplayName $ruleName; Write-Host "Removed the firewall rule." }
    else { Write-Host "A firewall rule named '$ruleName' is still there. Run this again as administrator to remove it." }
  }
  Write-Host "Your setup files (spaces, floor plan, PIN and so on) were left in $root."
  return
}

if (($AtStartup -or $OpenFirewall) -and -not $isAdmin) {
  throw "-AtStartup and -OpenFirewall need an administrator PowerShell. Open PowerShell with 'Run as administrator' and try again."
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js was not found. Install the LTS version from https://nodejs.org, open a new PowerShell window, and run this again." }
$major = [int]((& $node --version) -replace '^v(\d+)\..*', '$1')
if ($major -lt 18) { throw "Node.js $major is too old. Install version 18 or later from https://nodejs.org." }

Write-Host "Installing the libraries the app needs..."
Push-Location $root
try {
  & npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed. Check this computer's internet connection and try again." }
} finally { Pop-Location }

$venueFile = Join-Path $root 'venue.json'
$hasCore = $false
if (Test-Path $venueFile) {
  try { $v = Get-Content $venueFile -Raw | ConvertFrom-Json; $hasCore = [bool]($v.core -and $v.core.router -and $v.core.switcher) } catch {}
}
if (-not $hasCore) {
  Write-Warning "venue.json does not name a main router and main switcher yet. Run 'node server.js <router-ip> <switcher-ip>' once in $root so the addresses are saved, stop it with Ctrl+C, then run this script again."
}

$hostName = if ($LocalOnly) { '127.0.0.1' } else { '0.0.0.0' }
$config = @{ host = $hostName; port = $Port } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $root 'config.json'), $config, (New-Object Text.UTF8Encoding $false))
New-Item -ItemType Directory -Force (Join-Path $root 'logs') | Out-Null

$argument = '/c ""' + $node + '" server.js >> logs\venue-router.log 2>&1"'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $argument -WorkingDirectory $root
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
if ($AtStartup) {
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs the Venue Router routing console.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "The '$taskName' task is registered and started. It will start again $(if ($AtStartup) { 'whenever Windows starts' } else { 'whenever you sign in' })."

if ($OpenFirewall -and -not $LocalOnly) {
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain, Private | Out-Null
  }
  Write-Host "Windows Firewall now lets other devices on Domain and Private networks reach port $Port."
} elseif (-not $LocalOnly) {
  Write-Host "Windows Firewall was not changed. If other devices cannot open the app, run this again as administrator with -OpenFirewall, or allow Node.js when Windows asks."
}

Write-Host ""
Write-Host "On this computer, open:  http://localhost:$Port"
if (-not $LocalOnly) {
  Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host "From other devices, open: http://$($_.IPAddress):$Port" }
  Write-Host ""
  Write-Host "Next: open Engineer view on THIS computer, go to Spaces, and set a PIN. Until a PIN is set, Engineer view only works here."
}
Write-Host "The log is at $(Join-Path $root 'logs\venue-router.log')."
