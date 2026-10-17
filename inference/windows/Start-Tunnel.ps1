[CmdletBinding()]
param(
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA 'nishad-ai'),
    [int]$GatewayPort = 8094,
    [ValidatePattern('^[a-z0-9][a-z0-9-]{0,62}$')][string]$WorkerName,
    [switch]$Publish
)
$ErrorActionPreference = 'Stop'
if (!$Publish) { throw 'Opening a public tunnel requires the explicit -Publish switch.' }
if (!$env:GATEWAY_TOKEN) { throw 'Set GATEWAY_TOKEN and restart the gateway with it before publishing.' }
$cloudflared = Join-Path $RuntimeDirectory 'cloudflared.exe'
if (!(Test-Path -LiteralPath $cloudflared -PathType Leaf)) { throw 'cloudflared.exe is missing.' }
$state = Invoke-RestMethod "http://127.0.0.1:$GatewayPort/healthz" `
    -Headers @{ Authorization = 'Bearer ' + $env:GATEWAY_TOKEN } -TimeoutSec 5
if ($state.status -ne 'ok') { throw 'Gateway is not ready.' }
try {
    Invoke-RestMethod "http://127.0.0.1:$GatewayPort/healthz" -TimeoutSec 5 | Out-Null
    throw 'Gateway accepted an unauthenticated request. Restart it with GATEWAY_TOKEN before publishing.'
} catch [Microsoft.PowerShell.Commands.HttpResponseException] {
    if ([int]$_.Exception.Response.StatusCode -ne 401) { throw }
}
$logs = Join-Path $RuntimeDirectory 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$out = Join-Path $logs 'tunnel.out.log'
$err = Join-Path $logs 'tunnel.err.log'
$process = $null
try {
    $process = Start-Process $cloudflared -ArgumentList @(
        'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', "http://127.0.0.1:$GatewayPort"
    ) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
    $url = $null
    for ($i = 0; $i -lt 90; $i++) {
        if ($process.HasExited) { throw 'Tunnel exited before it became ready. Inspect private tunnel logs.' }
        $text = (Get-Content -LiteralPath $out,$err -Raw -ErrorAction Stop) -join "`n"
        $match = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($match.Success) { $url = $match.Value; break }
        Start-Sleep -Seconds 1
    }
    if (!$url) { throw 'No tunnel address became available within 90 seconds.' }
    if ($WorkerName) {
        $nodeDirectory = Join-Path $RuntimeDirectory 'node-v22.23.3-win-x64'
        $npm = Join-Path $nodeDirectory 'npx.cmd'
        if (!(Test-Path -LiteralPath $npm)) { throw 'The compatible Cloudflare CLI runtime is missing.' }
        $env:PATH = $nodeDirectory + ';' + $env:PATH
        $env:WRANGLER_SEND_METRICS = 'false'
        $config = Join-Path (Split-Path $PSScriptRoot -Parent) 'wrangler.toml'
        $url | & $npm --yes wrangler@4.149.0 secret put LAPTOP_UPSTREAM --config $config --name $WorkerName *>> (Join-Path $logs 'tunnel-route.log')
        if ($LASTEXITCODE -ne 0) { throw 'Laptop Worker route update failed. Inspect private route logs.' }
        Write-Output 'Protected laptop tunnel is active and its separate Worker route is updated.'
    } else {
        Write-Output 'Tunnel is active. Its address is recorded only in the private tunnel logs.'
    }
    $process.WaitForExit()
    throw "Tunnel exited with status $($process.ExitCode)."
} finally {
    if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
}
