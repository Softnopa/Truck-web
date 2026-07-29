# Restarts the Expo dev server.
#
#   .\restart.ps1        normal restart
#   .\restart.ps1 -Clear clears the Metro cache too (use after changing
#                        .env, app.json or babel.config.js)
#
# Sets __UNSAFE_EXPO_HOME_DIRECTORY because this profile's root
# (C:\Users\<you>) denies directory creation, and the Expo CLI exits if it
# cannot write ~/.expo.

param([switch]$Clear)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# Free Metro's port, but only that process — never a blanket node kill.
$busy = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    $busy | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        try {
            $name = (Get-Process -Id $_ -ErrorAction Stop).ProcessName
            Stop-Process -Id $_ -Force -ErrorAction Stop
            Write-Host "Stopped $name (pid $_) on port 8081" -ForegroundColor DarkGray
        } catch {
            Write-Host "Could not stop pid $_ : $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    Start-Sleep -Milliseconds 400
} else {
    Write-Host "Port 8081 already free" -ForegroundColor DarkGray
}

$env:__UNSAFE_EXPO_HOME_DIRECTORY = Join-Path $env:LOCALAPPDATA '.expo'

if ($Clear) {
    Write-Host "Starting Expo (cache cleared)..." -ForegroundColor Cyan
    npx expo start -c
} else {
    Write-Host "Starting Expo..." -ForegroundColor Cyan
    npx expo start
}
