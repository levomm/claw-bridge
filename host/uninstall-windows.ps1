$ErrorActionPreference = 'Stop'
$InstallDir = Join-Path $env:LOCALAPPDATA 'CLAW Host'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

Remove-ItemProperty -Path $runKey -Name 'CLAW Host' -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$InstallDir*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "CLAW Host startup entry was removed."
Write-Host "The program remains at $InstallDir and pairing data remains at $env:USERPROFILE\.claw-host."
Write-Host 'Delete those two folders manually only if you also want to remove the recoverable program files and token.'

