[CmdletBinding()]
param(
    [string]$WorkspaceRoot = [Environment]::GetFolderPath('MyDocuments')
)

$ErrorActionPreference = 'Stop'
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Join-Path $env:LOCALAPPDATA 'CLAW Host'
$DataDir = Join-Path $env:USERPROFILE '.claw-host'
$TokenFile = Join-Path $DataDir 'token'
$Launcher = Join-Path $InstallDir 'start-claw-host.ps1'
$NodeSource = Join-Path $SourceDir 'runtime\node.exe'

function Get-TailscaleIp {
    $candidates = @(
        (Get-Command tailscale.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
        (Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe')
    ) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($candidate in $candidates) {
        $address = (& $candidate ip -4 2>$null | Select-Object -First 1).Trim()
        if ($address -match '^100\.(?:6[4-9]|[789]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$') {
            return $address
        }
    }
    throw 'Tailscale must be installed, running, and signed in before CLAW Host is installed.'
}

if (-not (Test-Path $NodeSource)) {
    throw 'This installer is incomplete: runtime\node.exe is missing. Download the packaged CLAW Host artifact from GitHub Actions.'
}
if (-not (Test-Path $WorkspaceRoot -PathType Container)) {
    throw "Workspace root does not exist: $WorkspaceRoot"
}

$TailscaleIp = Get-TailscaleIp
New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null

Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$InstallDir*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

Copy-Item (Join-Path $SourceDir 'server.mjs') $InstallDir -Force
Copy-Item (Join-Path $SourceDir 'package.json') $InstallDir -Force
Copy-Item (Join-Path $SourceDir 'package-lock.json') $InstallDir -Force
Copy-Item (Join-Path $SourceDir 'node_modules') $InstallDir -Recurse -Force
Copy-Item (Join-Path $SourceDir 'runtime') $InstallDir -Recurse -Force
Copy-Item (Join-Path $SourceDir 'uninstall-windows.ps1') $InstallDir -Force

if (-not (Test-Path $TokenFile)) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    [IO.File]::WriteAllText($TokenFile, "$token`n", [Text.UTF8Encoding]::new($false))
}

$escapedInstall = $InstallDir.Replace("'", "''")
$escapedRoot = (Resolve-Path $WorkspaceRoot).Path.Replace("'", "''")
$escapedData = $DataDir.Replace("'", "''")
$launcherBody = @"
`$env:CLAW_HOST_BIND = '$TailscaleIp'
`$env:CLAW_HOST_PORT = '8790'
`$env:CLAW_HOST_ROOTS = '$escapedRoot'
`$env:CLAW_HOST_DATA = '$escapedData'
Set-Location '$escapedInstall'
& '$escapedInstall\runtime\node.exe' '$escapedInstall\server.mjs' *>> '$escapedData\host.log'
"@
[IO.File]::WriteAllText($Launcher, $launcherBody, [Text.UTF8Encoding]::new($false))

$runCommand = "powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`""
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name 'CLAW Host' -Value $runCommand -PropertyType String -Force | Out-Null

Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$Launcher`""
)
Start-Sleep -Seconds 2

$token = (Get-Content $TokenFile -Raw).Trim()
Write-Host ''
Write-Host 'CLAW Host is installed and running.' -ForegroundColor Green
Write-Host "Windows URL: ws://${TailscaleIp}:8790"
Write-Host "Pairing token: $token"
Write-Host "Workspace: $escapedRoot"
Write-Host ''
Write-Host 'Enter the URL and token in CLAW Bridge -> Settings -> Windows computer.'
