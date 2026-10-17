#Requires -Version 7.2
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA 'nishad-ai'),
    [switch]$CheckOnly,
    [switch]$IncludeCloudflareTools
)
$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'This bootstrap supports Windows 11 ARM64 and x64. It does not install on macOS or Linux.' }
$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($architecture -notin @('arm64', 'x64')) { throw "Unsupported architecture: $architecture" }
$taskName = 'Nishad Local Inference'
$settingsPath = Join-Path $RuntimeDirectory 'private-settings.json'
$headers = @{}
if (Test-Path -LiteralPath $settingsPath) {
    $private = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    if ($private.GatewayToken -notmatch '^[A-Za-z0-9_-]{32,128}$') { throw 'Invalid private gateway token configuration.' }
    $headers.Authorization = 'Bearer ' + $private.GatewayToken
}

function Test-Endpoint([string]$Url) {
    try { return (Invoke-RestMethod $Url -Headers $headers -TimeoutSec 3).status -eq 'ok' }
    catch [Microsoft.PowerShell.Commands.HttpResponseException] {
        if ([int]$_.Exception.Response.StatusCode -eq 401) { throw 'Gateway authentication failed; inspect private-settings.json.' }
        return $false
    } catch [System.Net.Http.HttpRequestException] { return $false }
    catch [System.Threading.Tasks.TaskCanceledException] { return $false }
}
function Get-InferenceState {
    $model = Test-Endpoint 'http://127.0.0.1:8081/health'
    $gateway = Test-Endpoint 'http://127.0.0.1:8094/healthz'
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    return [pscustomobject]@{
        Ready = $model -and $gateway
        ModelReady = $model
        GatewayReady = $gateway
        RecoveryTaskState = if ($task) { [string]$task.State } else { 'NotInstalled' }
    }
}
function Assert-OwnedListeners {
    foreach ($port in @(8081, 8094)) {
        $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
        foreach ($listener in $listeners) {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
            $expected = Join-Path $RuntimeDirectory $(if ($port -eq 8081) { 'llama-b11699\llama-server.exe' } else { 'python\python.exe' })
            if (!$process -or $process.ExecutablePath -ne $expected) {
                throw "Port $port belongs to another application. No process was stopped."
            }
        }
    }
}
function Install-Download([string]$Url, [string]$Name, [string]$Hash, [string]$ExtractTo = '') {
    $destination = Join-Path $downloads $Name
    if (Test-Path -LiteralPath $destination) {
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $Hash) {
            throw "Cached artifact checksum mismatch: $Name. Remove only that named artifact and retry."
        }
    } else {
        $temporary = $destination + '.partial'
        if (Test-Path -LiteralPath $temporary) {
            throw "Incomplete download exists: $temporary. Remove only that named partial file and retry."
        }
        try {
            Invoke-WebRequest $Url -OutFile $temporary
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $Hash) {
                throw "Downloaded artifact checksum mismatch: $Name"
            }
            Move-Item -LiteralPath $temporary -Destination $destination
        } finally {
            if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
        }
    }
    if ($ExtractTo) { Expand-Archive -LiteralPath $destination -DestinationPath $ExtractTo -Force }
    return $destination
}

$state = Get-InferenceState
if ($CheckOnly) { $state; return }
Assert-OwnedListeners
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne 'Project-managed loopback-only Nishad inference recovery.') {
    throw 'An unrelated task has the inference task name. It was not changed.'
}
$supervisor = Join-Path $PSScriptRoot 'Watch-Inference.ps1'
if ($existing -and $existing.Actions.Arguments -notlike ('*"' + $supervisor + '"*')) {
    throw 'Recovery is registered from another checkout. Disable/stop that task and re-register from this retained project first.'
}
if ($state.Ready -and $existing -and $existing.State -eq 'Running') {
    Write-Output 'Inference is already healthy and managed. No downloads, restart, or configuration changes were made.'
    $state
    return
}
if (!$PSCmdlet.ShouldProcess($RuntimeDirectory, 'Install missing inference runtimes/model and configure sign-in recovery')) { return }
$downloads = Join-Path $RuntimeDirectory 'downloads'
New-Item -ItemType Directory -Force -Path $downloads,(Join-Path $RuntimeDirectory 'models') | Out-Null
$ProgressPreference = 'SilentlyContinue'
$pythonArch = if ($architecture -eq 'arm64') { 'arm64' } else { 'amd64' }
$pythonHash = if ($architecture -eq 'arm64') {
    'cba392bd5c7aed68b26d1b523822cc3d80802c085481dfde79262ebfc7179d26'
} else { '91d828c2da3a029b41699e918674a0cb379c02cf20dab9c501306885f837402a' }
$llamaHash = if ($architecture -eq 'arm64') {
    '2d36bdc1602e63927316a4ecf64a957d43ea42f5e8c1576db250ecdb30ada202'
} else { '4cffd1a580bc42f072a6f01bd34822e09e42368631486160300f1bed3e6d2be0' }
$nodeHash = if ($architecture -eq 'arm64') {
    '33dad22e4cef5ee8f9fbb1b0d037fdacd0e56d12a4580f0d63f68b894deab535'
} else { '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71' }
if (!(Test-Path -LiteralPath (Join-Path $RuntimeDirectory 'python\python.exe'))) {
    Install-Download "https://www.python.org/ftp/python/3.13.9/python-3.13.9-embed-$pythonArch.zip" `
        "python-3.13.9-$architecture.zip" $pythonHash (Join-Path $RuntimeDirectory 'python') | Out-Null
}
if (!(Test-Path -LiteralPath (Join-Path $RuntimeDirectory 'llama-b11699\llama-server.exe'))) {
    Install-Download "https://github.com/ggml-org/llama.cpp/releases/download/b11699/llama-b11699-bin-win-cpu-$architecture.zip" `
        "llama-b11699-$architecture.zip" $llamaHash (Join-Path $RuntimeDirectory 'llama-b11699') | Out-Null
}
$model = Join-Path $RuntimeDirectory 'models\Qwen3-4B-Q4_K_M.gguf'
$modelHash = '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'
if (Test-Path -LiteralPath $model) {
    if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash -ne $modelHash) { throw 'Installed model checksum mismatch.' }
} else {
    $artifact = Install-Download 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf' 'Qwen3-4B-Q4_K_M.gguf' $modelHash
    Move-Item -LiteralPath $artifact -Destination $model
}
$license = Join-Path $RuntimeDirectory 'models\Qwen3-LICENSE'
if (!(Test-Path -LiteralPath $license)) {
    Invoke-WebRequest 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/LICENSE' -OutFile $license
}
if (!(Test-Path -LiteralPath (Join-Path $RuntimeDirectory "node-v22.23.3-win-$architecture\node.exe"))) {
    Install-Download "https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-$architecture.zip" `
        "node-v22.23.3-$architecture.zip" $nodeHash $RuntimeDirectory | Out-Null
}
if ($IncludeCloudflareTools) {
    if (!(Test-Path -LiteralPath (Join-Path $RuntimeDirectory 'node-v22.23.3-win-x64\node.exe'))) {
        Install-Download 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip' 'node-v22.23.3-x64.zip' `
            '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71' $RuntimeDirectory | Out-Null
    }
    if (!(Test-Path -LiteralPath (Join-Path $RuntimeDirectory 'cloudflared.exe'))) {
        $artifact = Install-Download 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.1/cloudflared-windows-amd64.exe' `
            'cloudflared-2026.10.1.exe' '4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6'
        Copy-Item -LiteralPath $artifact -Destination (Join-Path $RuntimeDirectory 'cloudflared.exe')
    }
}
if ($state.Ready -and (!$existing -or $existing.State -ne 'Running')) {
    throw 'Inference is running manually. Stop its owned launcher before enabling scheduled recovery; no running process was stopped.'
}
if ($existing -and $existing.State -eq 'Running') {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    try { Stop-ScheduledTask -TaskName $taskName }
    finally { Enable-ScheduledTask -TaskName $taskName | Out-Null }
    Start-Sleep -Seconds 2
}
if (Get-NetTCPConnection -State Listen -LocalPort 8081,8094 -ErrorAction SilentlyContinue) {
    throw 'Existing listeners must be stopped by their owner before bootstrap can start inference.'
}
& (Join-Path $PSScriptRoot 'Install-Recovery.ps1') -RuntimeDirectory $RuntimeDirectory -StartNow
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    $state = Get-InferenceState
    if ($state.Ready) {
        Write-Output 'Inference is healthy and sign-in recovery is installed. Public exposure was not enabled by bootstrap.'
        $state
        return
    }
}
throw 'Bootstrap installed the runtime, but readiness failed. Inspect the private runtime logs; no success is claimed.'
