[CmdletBinding()]
param(
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA 'nishad-ai'),
    [ValidateRange(5, 300)][int]$RetrySeconds = 15
)
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'Start-Inference.ps1'
$logs = Join-Path $RuntimeDirectory 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs 'recovery.log'
$lock = [System.Threading.Mutex]::new($false, 'Local\NishadInferenceRecovery')
$acquired = $false
try {
    try { $acquired = $lock.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $acquired = $true }
    if (!$acquired) { throw 'Another inference recovery supervisor is already running.' }
    while ($true) {
        try {
            $settingsPath = Join-Path $RuntimeDirectory 'private-settings.json'
            $publish = $false
            $worker = ''
            if (Test-Path -LiteralPath $settingsPath) {
                $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
                if ($settings.GatewayToken -notmatch '^[A-Za-z0-9_-]{32,128}$') { throw 'Invalid private gateway token configuration.' }
                $env:GATEWAY_TOKEN = $settings.GatewayToken
                $publish = $settings.PublishEnabled -eq $true
                $worker = $settings.WorkerName
                if ($publish -and $worker -notmatch '^[a-z0-9][a-z0-9-]{0,62}$') { throw 'Invalid private Worker configuration.' }
            }
            & $launcher -RuntimeDirectory $RuntimeDirectory -Publish:$publish -WorkerName $worker
            throw 'Inference launcher returned unexpectedly.'
        } catch {
            $message = '{0:o} Inference stopped: {1} Retrying in {2}s.' -f (Get-Date), $_.Exception.Message, $RetrySeconds
            if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1MB) {
                Move-Item -LiteralPath $log -Destination ($log + '.previous') -Force
            }
            Add-Content -LiteralPath $log -Value $message
            Write-Warning $message
        }
        Start-Sleep -Seconds $RetrySeconds
    }
} finally {
    if ($acquired) { $lock.ReleaseMutex() }
    $lock.Dispose()
}
