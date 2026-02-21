# LFO Smoke Test Script
# Run from project root after lfo-core and android-bridge are both running.
# Usage: .\smoke-test.ps1
# Optional: .\smoke-test.ps1 -Token "your-auth-token"

param(
  [string]$BaseUrl = "http://localhost:8080",
  [string]$Token   = ""
)

$pass = 0
$fail = 0

Write-Host ""
Write-Host "LFO Smoke Tests" -ForegroundColor Cyan
Write-Host "===============" -ForegroundColor Cyan
Write-Host "Target: $BaseUrl"
Write-Host ""

function Build-Headers {
  $h = @{ "Content-Type" = "application/json" }
  if ($Token -ne "") { $h["Authorization"] = "Bearer $Token" }
  return $h
}

function Check($label, $actual, $expected, $msg = "") {
  if ($actual -eq $expected) {
    Write-Host "  PASS  $label" -ForegroundColor Green
    $script:pass += 1
  } else {
    Write-Host "  FAIL  $label — expected '$expected', got '$actual'" -ForegroundColor Red
    if ($msg) { Write-Host "        $msg" -ForegroundColor DarkGray }
    $script:fail += 1
  }
}

# ---------------------------------------------------------------------------
# 1. Health check
# ---------------------------------------------------------------------------
Write-Host "[1] GET /health" -ForegroundColor Gray
try {
  $r = Invoke-RestMethod -Method GET -Uri "$BaseUrl/health" -TimeoutSec 5
  Check "status = ok"        $r.status    "ok"
  Check "version present"    ($r.version -ne $null) $true
} catch {
  Write-Host "  FAIL  /health unreachable — is lfo-core running? ($($_.Exception.Message))" -ForegroundColor Red
  $fail += 1
}

# ---------------------------------------------------------------------------
# 2. Cloud path (mode=cloud)
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[2] POST /v1/chat/completions  mode=cloud" -ForegroundColor Gray
try {
  $body = @{
    messages = @(@{ role = "user"; content = "Reply with exactly one word: PONG" })
    max_tokens = 8
    temperature = 0.1
    metadata = @{ mode = "cloud" }
  } | ConvertTo-Json -Depth 5

  $r = Invoke-RestMethod -Method POST -Uri "$BaseUrl/v1/chat/completions" `
       -Headers (Build-Headers) -Body $body -TimeoutSec 30

  Check "HTTP 200"         ($r.choices.Count -gt 0)         $true
  Check "model = lfo-gemini" $r.model "lfo-gemini"
  Check "has usage"        ($r.usage.total_tokens -gt 0)    $true
  Write-Host "        response: $($r.choices[0].message.content)" -ForegroundColor DarkGray
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Host "  FAIL  cloud request failed — HTTP $status ($($_.Exception.Message))" -ForegroundColor Red
  $fail += 1
}

# ---------------------------------------------------------------------------
# 3. Local path (mode=local)
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[3] POST /v1/chat/completions  mode=local" -ForegroundColor Gray
try {
  $body = @{
    messages = @(@{ role = "user"; content = "Reply with exactly one word: PONG" })
    max_tokens = 8
    temperature = 0.1
    metadata = @{ mode = "local" }
  } | ConvertTo-Json -Depth 5

  $r = Invoke-RestMethod -Method POST -Uri "$BaseUrl/v1/chat/completions" `
       -Headers (Build-Headers) -Body $body -TimeoutSec 120

  Check "HTTP 200"              ($r.choices.Count -gt 0)           $true
  Check "model = lfo-local-*"  $r.model.StartsWith("lfo-local")   $true
  Check "has usage"             ($r.usage.total_tokens -gt 0)      $true
  Write-Host "        response: $($r.choices[0].message.content)" -ForegroundColor DarkGray
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Host "  FAIL  local request failed — HTTP $status" -ForegroundColor Red
  Write-Host "        Is android-bridge running? Is lfo-mobile running on device?" -ForegroundColor DarkGray
  Write-Host "        $($_.Exception.Message)" -ForegroundColor DarkGray
  $fail += 1
}

# ---------------------------------------------------------------------------
# 4. Dashboard stats endpoint
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[4] GET /dashboard/api/stats" -ForegroundColor Gray
try {
  $r = Invoke-RestMethod -Method GET -Uri "$BaseUrl/dashboard/api/stats" -TimeoutSec 5
  Check "has status.circuit_state"    ($null -ne $r.status.circuit_state)    $true
  Check "has status.uptime_ms"        ($r.status.uptime_ms -ge 0)            $true
  Check "has totals.requests"         ($null -ne $r.totals.requests)          $true
  Check "recent is array"             ($r.recent -is [array])                 $true
  Write-Host "        circuit_state: $($r.status.circuit_state)" -ForegroundColor DarkGray
  Write-Host "        total requests recorded: $($r.totals.requests)" -ForegroundColor DarkGray
} catch {
  Write-Host "  FAIL  /dashboard/api/stats unreachable ($($_.Exception.Message))" -ForegroundColor Red
  $fail += 1
}

# ---------------------------------------------------------------------------
# 5. Dashboard HTML
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[5] GET /dashboard" -ForegroundColor Gray
try {
  $resp = Invoke-WebRequest -Method GET -Uri "$BaseUrl/dashboard" -TimeoutSec 5
  Check "HTTP 200"           $resp.StatusCode      200
  Check "is HTML"            ($resp.Content -match "<!DOCTYPE html>") $true
} catch {
  Write-Host "  FAIL  /dashboard unreachable ($($_.Exception.Message))" -ForegroundColor Red
  $fail += 1
}

# ---------------------------------------------------------------------------
# 6. stream:true → 501
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[6] POST /v1/chat/completions  stream=true → 501" -ForegroundColor Gray
try {
  $body = @{
    messages = @(@{ role = "user"; content = "hi" })
    stream = $true
  } | ConvertTo-Json -Depth 3

  Invoke-RestMethod -Method POST -Uri "$BaseUrl/v1/chat/completions" `
    -Headers (Build-Headers) -Body $body -TimeoutSec 5 | Out-Null
  Write-Host "  FAIL  expected 501, got 200" -ForegroundColor Red
  $fail += 1
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Check "returns 501" $status 501
}

# ---------------------------------------------------------------------------
# 7. Invalid token → 401 (only when auth is enabled)
# ---------------------------------------------------------------------------
if ($Token -ne "") {
  Write-Host ""
  Write-Host "[7] POST /v1/chat/completions  bad token → 401" -ForegroundColor Gray
  try {
    $body = @{ messages = @(@{ role = "user"; content = "hi" }) } | ConvertTo-Json
    $badHeaders = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer wrong-token" }
    Invoke-RestMethod -Method POST -Uri "$BaseUrl/v1/chat/completions" `
      -Headers $badHeaders -Body $body -TimeoutSec 5 | Out-Null
    Write-Host "  FAIL  expected 401, got 200" -ForegroundColor Red
    $fail += 1
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    Check "returns 401" $status 401
  }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "===============" -ForegroundColor Cyan
$total = $pass + $fail
if ($fail -eq 0) {
  Write-Host "All $total checks passed." -ForegroundColor Green
} else {
  Write-Host "$pass/$total passed   $fail failed" -ForegroundColor $(if ($fail -gt 0) { "Red" } else { "Green" })
}
Write-Host ""
