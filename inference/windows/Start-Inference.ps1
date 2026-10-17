[CmdletBinding()]
param(
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA 'nishad-ai'),
    [string]$ModelPath,
    [int]$ModelPort = 8081,
    [int]$GatewayPort = 8094,
    [ValidateRange(1, 12)][int]$Threads = 6,
    [string]$AllowedOrigins = 'https://nishad.ai',
    [switch]$Publish,
    [string]$WorkerName
)
$ErrorActionPreference = 'Stop'
if (!('NishadInferenceJob' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class NishadInferenceJob {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters {
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(SafeFileHandle job, int infoClass, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
    public static SafeFileHandle Create() {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>())) {
            var error = Marshal.GetLastWin32Error();
            job.Dispose();
            throw new Win32Exception(error);
        }
        return job;
    }
    public static void Assign(SafeFileHandle job, IntPtr process) {
        if (!AssignProcessToJobObject(job, process)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
'@
}
if (!$ModelPath) { $ModelPath = Join-Path $RuntimeDirectory 'models\Qwen3-4B-Q4_K_M.gguf' }
$python = Join-Path $RuntimeDirectory 'python\python.exe'
$llama = Join-Path $RuntimeDirectory 'llama-b11699\llama-server.exe'
$gateway = Join-Path (Split-Path $PSScriptRoot -Parent) 'gateway.py'
foreach ($file in @($python, $llama, $ModelPath, $gateway, (Join-Path (Split-Path $PSScriptRoot -Parent) 'telemetry.py'))) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}
foreach ($port in @($ModelPort, $GatewayPort)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. No existing process was stopped."
    }
}
$logs = Join-Path $RuntimeDirectory 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$modelProcess = $null
$gatewayProcess = $null
$tunnelProcess = $null
$environmentNames = @('INFERENCE_BACKEND', 'LLAMA_BASE_URL', 'LISTEN', 'ALLOWED_ORIGINS')
$previous = @{}
foreach ($name in $environmentNames) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$job = [NishadInferenceJob]::Create()
try {
    $modelProcess = Start-Process -FilePath $llama -ArgumentList @(
        '-m', "`"$ModelPath`"", '--host', '127.0.0.1', '--port', $ModelPort,
        '-c', '4096', '-np', '1', '-t', $Threads, '-tb', $Threads,
        '-ngl', '0', '--jinja', '--log-disable'
    ) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'model.out.log') `
        -RedirectStandardError (Join-Path $logs 'model.err.log')
    [NishadInferenceJob]::Assign($job, $modelProcess.Handle)
    $ready = $false
    for ($i = 0; $i -lt 120; $i++) {
        if ($modelProcess.HasExited) { throw 'Model process exited; inspect the local model logs.' }
        try {
            $state = Invoke-RestMethod "http://127.0.0.1:$ModelPort/health" -TimeoutSec 2
            $ready = $state.status -eq 'ok'
        } catch [Microsoft.PowerShell.Commands.HttpResponseException] {
            if ([int]$_.Exception.Response.StatusCode -ne 503 -or $i -eq 119) { throw }
        } catch [System.Net.Http.HttpRequestException] {
            if ($i -eq 119) { throw 'Model did not become ready within the startup window.' }
        } catch [System.Threading.Tasks.TaskCanceledException] {
            if ($i -eq 119) { throw 'Model startup health check timed out.' }
        }
        if ($ready) { break }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'Model did not become ready within the startup window.' }
    $env:INFERENCE_BACKEND = 'llama.cpp'
    $env:LLAMA_BASE_URL = "http://127.0.0.1:$ModelPort"
    $env:LISTEN = "127.0.0.1:$GatewayPort"
    $env:ALLOWED_ORIGINS = $AllowedOrigins
    $gatewayProcess = Start-Process -FilePath $python -ArgumentList @('-u', "`"$gateway`"") `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'gateway.out.log') `
        -RedirectStandardError (Join-Path $logs 'gateway.err.log')
    [NishadInferenceJob]::Assign($job, $gatewayProcess.Handle)
    $headers = @{}
    if ($env:GATEWAY_TOKEN) { $headers.Authorization = 'Bearer ' + $env:GATEWAY_TOKEN }
    $gatewayReady = $false
    for ($i = 0; $i -lt 20; $i++) {
        if ($gatewayProcess.HasExited) { throw 'Gateway process exited; inspect the local gateway logs.' }
        try {
            $state = Invoke-RestMethod "http://127.0.0.1:$GatewayPort/healthz" -Headers $headers -TimeoutSec 2
            $gatewayReady = $state.status -eq 'ok'
        } catch [Microsoft.PowerShell.Commands.HttpResponseException] {
            if ([int]$_.Exception.Response.StatusCode -ne 503 -or $i -eq 19) { throw }
        } catch [System.Net.Http.HttpRequestException] {
            if ($i -eq 19) { throw 'Gateway did not become ready.' }
        } catch [System.Threading.Tasks.TaskCanceledException] {
            if ($i -eq 19) { throw 'Gateway startup health check timed out.' }
        }
        if ($gatewayReady) { break }
        Start-Sleep -Seconds 1
    }
    if (!$gatewayReady) { throw 'Gateway did not become ready.' }
    if ($Publish) {
        if (!$env:GATEWAY_TOKEN -or !$WorkerName) { throw 'Public tunnel requires a gateway token and separate Worker name.' }
        $tunnel = Join-Path $PSScriptRoot 'Start-Tunnel.ps1'
        $tunnelProcess = Start-Process (Join-Path $PSHOME 'pwsh.exe') -ArgumentList @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', "`"$tunnel`"",
            '-Publish', '-WorkerName', $WorkerName, '-GatewayPort', $GatewayPort,
            '-RuntimeDirectory', "`"$RuntimeDirectory`""
        ) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'bridge.out.log') `
            -RedirectStandardError (Join-Path $logs 'bridge.err.log')
        [NishadInferenceJob]::Assign($job, $tunnelProcess.Handle)
    }
    Write-Output "Inference ready at http://127.0.0.1:$GatewayPort. Public tunnel enabled: $Publish."
    while (!$modelProcess.HasExited -and !$gatewayProcess.HasExited -and (!$tunnelProcess -or !$tunnelProcess.HasExited)) { Start-Sleep -Seconds 2 }
    throw 'An inference process stopped. The other owned process will be stopped; restart after inspecting logs.'
} finally {
    $job.Dispose()
    foreach ($process in @($tunnelProcess, $gatewayProcess, $modelProcess)) {
        if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    }
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
}
