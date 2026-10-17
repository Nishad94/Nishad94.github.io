[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TaskName = 'Nishad Local Inference',
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA 'nishad-ai'),
    [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
$supervisor = Join-Path $PSScriptRoot 'Watch-Inference.ps1'
$powerShell = Join-Path $PSHOME 'pwsh.exe'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($file in @(
    $supervisor, $powerShell, (Join-Path $PSScriptRoot 'Start-Inference.ps1'),
    (Join-Path (Split-Path $PSScriptRoot -Parent) 'gateway.py'),
    (Join-Path (Split-Path $PSScriptRoot -Parent) 'telemetry.py'),
    (Join-Path $RuntimeDirectory 'python\python.exe'),
    (Join-Path $RuntimeDirectory 'llama-b11699\llama-server.exe'),
    (Join-Path $RuntimeDirectory 'models\Qwen3-4B-Q4_K_M.gguf')
)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}
if ($RuntimeDirectory.Contains('"') -or $supervisor.Contains('"')) { throw 'Paths cannot contain double quotes.' }
$action = New-ScheduledTaskAction -Execute $powerShell -Argument (
    '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -RuntimeDirectory "{1}"' -f $supervisor, $RuntimeDirectory
) -WorkingDirectory (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne 'Project-managed loopback-only Nishad inference recovery.') {
    throw "Task '$TaskName' already exists and is not managed by this installer."
}
if ($existing -and $existing.State -eq 'Running') {
    throw 'Stop the existing inference task before changing its configuration.'
}
if ($PSCmdlet.ShouldProcess($TaskName, 'Register sign-in inference recovery task')) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigger, $watchdog) -Principal $principal `
        -Settings $settings -Description 'Project-managed loopback-only Nishad inference recovery.' -Force | Out-Null
    if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }
    Write-Output "Registered '$TaskName' for $user at sign-in. Source: $supervisor"
}
