# ============================================================
# serve.ps1 - Minimal static file server (PowerShell / HttpListener)
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8000
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8000 -Bind any  (LAN, needs admin)
# ============================================================
param(
  [int]$Port = 8000,
  [ValidateSet('localhost', 'any')]
  [string]$Bind = 'localhost'
)

$root = (Split-Path -Parent $PSScriptRoot)
$rootFull = [System.IO.Path]::GetFullPath($root)

$listener = New-Object System.Net.HttpListener
if ($Bind -eq 'any') {
  $prefix = "http://+:$Port/"
} else {
  $prefix = "http://localhost:$Port/"
}
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Output "FAILED to start listener on $prefix : $($_.Exception.Message)"
  if ($Bind -eq 'any') {
    Write-Output "TIP: running with -Bind any requires an elevated (Administrator) PowerShell."
  }
  exit 1
}

Write-Output "Serving '$rootFull' at $prefix"

if ($Bind -eq 'any') {
  try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
      Select-Object -ExpandProperty IPAddress -Unique
    foreach ($ip in $ips) { Write-Output "LAN: http://$ip`:$Port/" }
  } catch { }
  Write-Output "NOTE: Android Chrome blocks microphone on plain http:// LAN addresses."
  Write-Output "      Either use https, or add the origin to chrome://flags/#unsafely-treat-insecure-origin-as-secure"
}

Write-Output "Press Ctrl+C to stop."

$mime = @{
  '.html'        = 'text/html; charset=utf-8'
  '.htm'         = 'text/html; charset=utf-8'
  '.css'         = 'text/css; charset=utf-8'
  '.js'          = 'application/javascript; charset=utf-8'
  '.mjs'         = 'application/javascript; charset=utf-8'
  '.json'        = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.png'         = 'image/png'
  '.jpg'         = 'image/jpeg'
  '.jpeg'        = 'image/jpeg'
  '.svg'         = 'image/svg+xml'
  '.ico'         = 'image/x-icon'
  '.woff2'       = 'font/woff2'
  '.txt'         = 'text/plain; charset=utf-8'
}

while ($listener.IsListening) {
  $ctx = $null
  try {
    $ctx = $listener.GetContext()
  } catch {
    break
  }

  $req = $ctx.Request
  $res = $ctx.Response
  $res.Headers.Add('Cache-Control', 'no-store')

  try {
    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ([string]::IsNullOrWhiteSpace($path) -or $path -eq '/') { $path = '/index.html' }

    $rel = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))

    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
      $body = [System.Text.Encoding]::UTF8.GetBytes('403 Forbidden')
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.ContentLength64 = $body.Length
      $res.OutputStream.Write($body, 0, $body.Length)
    }
    elseif (Test-Path -LiteralPath $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $type = $mime[$ext]
      if (-not $type) { $type = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.ContentType = $type
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    else {
      $res.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.ContentLength64 = $body.Length
      $res.OutputStream.Write($body, 0, $body.Length)
    }
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    try { $res.OutputStream.Close() } catch { }
    try { $res.Close() } catch { }
  }
}
