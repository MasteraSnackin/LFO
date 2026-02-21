# LFO Environment Validation Script
# Run from the project root: .\validate-env.ps1
# Checks all required config before starting a debug session.

$errors = @()
$warnings = @()

Write-Host ""
Write-Host "LFO Environment Validation" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# lfo-core/.env
# ---------------------------------------------------------------------------
$envFile = "lfo-core\.env"
Write-Host "Checking $envFile ..." -ForegroundColor Gray

if (-not (Test-Path $envFile)) {
    $errors += "MISSING: $envFile — copy lfo-core/.env.example and fill in values"
} else {
    $envLines = Get-Content $envFile | Where-Object { $_ -match "=" -and $_ -notmatch "^\s*#" }
    $keys = $envLines | ForEach-Object { ($_ -split "=")[0].Trim() }

    foreach ($required in @("GEMINI_API_KEY", "ANDROID_HOST", "ANDROID_PORT")) {
        if ($required -notin $keys) {
            $errors += "MISSING KEY: $required in $envFile"
        }
    }

    $apiKey = ($envLines | Where-Object { $_ -match "^GEMINI_API_KEY" } | Select-Object -First 1) -replace "^GEMINI_API_KEY=", ""
    if ($apiKey -eq "" -or $apiKey -match "^<") {
        $errors += "INVALID: GEMINI_API_KEY is a placeholder — set a real API key"
    } else {
        Write-Host "  OK: GEMINI_API_KEY is set" -ForegroundColor Green
    }

    $androidHost = ($envLines | Where-Object { $_ -match "^ANDROID_HOST" } | Select-Object -First 1) -replace "^ANDROID_HOST=", ""
    if ($androidHost -eq "" -or $androidHost -match "^<") {
        $errors += "INVALID: ANDROID_HOST is a placeholder — set your Android device's LAN IP"
    } else {
        Write-Host "  OK: ANDROID_HOST = $androidHost" -ForegroundColor Green

        # Ping check
        $ping = Test-Connection -ComputerName $androidHost -Count 1 -Quiet -ErrorAction SilentlyContinue
        if ($ping) {
            Write-Host "  OK: Android host $androidHost is reachable (ping)" -ForegroundColor Green
        } else {
            $warnings += "WARN: Android host $androidHost did not respond to ping — device may be offline or ICMP blocked"
        }
    }

    $authToken = ($envLines | Where-Object { $_ -match "^LFO_AUTH_TOKEN" } | Select-Object -First 1) -replace "^LFO_AUTH_TOKEN=", ""
    if ($authToken -ne "") {
        Write-Host "  OK: LFO_AUTH_TOKEN is set (auth enabled)" -ForegroundColor Green
    } else {
        Write-Host "  INFO: LFO_AUTH_TOKEN not set — auth disabled" -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# lfo-core/node_modules
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Checking lfo-core dependencies ..." -ForegroundColor Gray

if (-not (Test-Path "lfo-core\node_modules")) {
    $errors += "MISSING: lfo-core\node_modules — run: cd lfo-core && npm install"
} else {
    Write-Host "  OK: node_modules present" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# lfo-core/.env.test
# ---------------------------------------------------------------------------
if (-not (Test-Path "lfo-core\.env.test")) {
    $errors += "MISSING: lfo-core\.env.test — required for npm test (create with GEMINI_API_KEY=test-key-placeholder)"
} else {
    Write-Host "  OK: .env.test present" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# android-bridge/.env
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Checking android-bridge ..." -ForegroundColor Gray

if (-not (Test-Path "android-bridge\.env")) {
    $warnings += "WARN: android-bridge\.env not found — bridge will use defaults (port 5555, host from lfo-core .env)"
} else {
    Write-Host "  OK: android-bridge\.env present" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Port availability (Windows)
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Checking port availability ..." -ForegroundColor Gray

foreach ($port in @(8080, 5555)) {
    $inUse = netstat -ano 2>$null | Select-String ":$port\s" | Where-Object { $_ -match "LISTENING" }
    if ($inUse) {
        $pid = ($inUse | Select-Object -First 1).ToString().Trim() -replace ".*\s+(\d+)$", '$1'
        Write-Host "  INFO: Port $port already in use (PID $pid) — may be a running LFO instance" -ForegroundColor Yellow
    } else {
        Write-Host "  OK: Port $port is free" -ForegroundColor Green
    }
}

# ---------------------------------------------------------------------------
# adb + Android device
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Checking Android device (adb) ..." -ForegroundColor Gray

$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) {
    Write-Host "  INFO: adb not in PATH — skipping device checks" -ForegroundColor Yellow
    Write-Host "        Install Android Platform Tools to enable device checks" -ForegroundColor DarkGray
} else {
    $devices = adb devices 2>$null | Select-Object -Skip 1 | Where-Object { $_ -match "device$" }
    if (-not $devices) {
        $warnings += "WARN: No Android device connected via adb — local path will not work"
    } else {
        Write-Host "  OK: Android device connected" -ForegroundColor Green

        # Check TCP port 6000 on device
        $tcpCheck = adb shell ss -tlnp 2>$null | Select-String ":6000"
        if ($tcpCheck) {
            Write-Host "  OK: TCP port 6000 is listening on device (lfo-mobile server running)" -ForegroundColor Green
        } else {
            $warnings += "WARN: TCP port 6000 not listening on Android — lfo-mobile app may not be running"
        }

        # Check model file
        $model = adb shell ls /sdcard/function-gemma-270m.gguf 2>&1
        if ($model -match "No such file") {
            $errors += "MISSING: Model file not on device — run: adb push function-gemma-270m.gguf /sdcard/"
        } else {
            $size = adb shell ls -lh /sdcard/function-gemma-270m.gguf 2>$null
            Write-Host "  OK: Model file present on device" -ForegroundColor Green
        }
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "==========================" -ForegroundColor Cyan

if ($warnings.Count -gt 0) {
    Write-Host "Warnings:" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host ""
}

if ($errors.Count -eq 0) {
    Write-Host "All checks passed. LFO is ready to run." -ForegroundColor Green
    Write-Host ""
    Write-Host "Start commands:" -ForegroundColor Cyan
    Write-Host "  lfo-core:       cd lfo-core && npm run dev"
    Write-Host "  android-bridge: cd android-bridge && node index.js"
    Write-Host "  Tests:          cd lfo-core && npm test"
} else {
    Write-Host "Issues found ($($errors.Count)):" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Fix the above before starting LFO." -ForegroundColor Red
}

Write-Host ""
