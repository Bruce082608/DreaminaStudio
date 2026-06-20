# Dreamina Studio - one-command frontend deployment
# Usage:
#   .\deploy_frontend.ps1
#   .\deploy_frontend.ps1 -ServerIp 43.129.24.162 -SshUser root
#   .\deploy_frontend.ps1 -SshKey C:\path\to\key.pem

[CmdletBinding()]
param(
    [string]$ServerIp = "43.129.24.162",
    [string]$SshUser = "root",
    [string]$RemoteDir = "/var/www/dreamina_studio",
    [string]$ReleaseDir = "/var/www/dreamina_studio_releases",
    [string]$NginxConfDir = "/etc/nginx/conf.d",
    [string]$NginxConfFile = "dreamina_studio.conf",
    [string]$SshKey = "",
    [switch]$SkipNginxConfig,
    [switch]$KeepArchive
)

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$archiveName = "dreamina_studio_frontend_$timestamp.tgz"
$archivePath = Join-Path $repoRoot $archiveName
$remoteArchive = "/tmp/$archiveName"
$remoteTarget = "$SshUser@$ServerIp"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

$sshOptions = @(
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=15"
)

if ($SshKey.Trim()) {
    $sshOptions += @("-i", $SshKey)
}

try {
    Push-Location $repoRoot

    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "Dreamina Studio frontend deploy" -ForegroundColor Cyan
    Write-Host "Target: ${remoteTarget}:$RemoteDir" -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Cyan

    Write-Step "Building frontend"
    Invoke-Native npm run build

    if (!(Test-Path (Join-Path $repoRoot "dist\index.html"))) {
        throw "Build output dist\index.html was not found."
    }

    Write-Step "Packaging dist"
    if (Test-Path $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    Invoke-Native tar -C "dist" -czf $archivePath "."

    Write-Step "Preparing remote release directory"
    $prepareRemote = @"
set -e
mkdir -p '$RemoteDir' '$ReleaseDir'
if [ -d '$RemoteDir' ] && [ "`$(find '$RemoteDir' -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then
  cp -a '$RemoteDir' '$ReleaseDir/dreamina_studio_$timestamp'
fi
"@
    Invoke-Native ssh @sshOptions $remoteTarget $prepareRemote

    Write-Step "Uploading frontend archive"
    Invoke-Native scp @sshOptions $archivePath "${remoteTarget}:$remoteArchive"

    Write-Step "Publishing frontend on server"
    $publishRemote = @"
set -e
rm -rf '$RemoteDir'/*
tar -xzf '$remoteArchive' -C '$RemoteDir'
chown -R root:root '$RemoteDir'
find '$RemoteDir' -type d -exec chmod 755 {} \;
find '$RemoteDir' -type f -exec chmod 644 {} \;
rm -f '$remoteArchive'
"@
    Invoke-Native ssh @sshOptions $remoteTarget $publishRemote

    if (!$SkipNginxConfig) {
        $localNginxConf = Join-Path $repoRoot $NginxConfFile
        if (!(Test-Path $localNginxConf)) {
            throw "Nginx config file was not found: $localNginxConf"
        }

        Write-Step "Uploading Nginx config"
        Invoke-Native scp @sshOptions $localNginxConf "${remoteTarget}:$NginxConfDir/$NginxConfFile"
    }

    Write-Step "Testing and reloading Nginx"
    Invoke-Native ssh @sshOptions $remoteTarget "nginx -t && systemctl reload nginx"

    Write-Step "Verifying deployed site"
    $siteUrl = "http://$ServerIp/"
    $apiUrl = "http://$ServerIp/api/health"
    $siteResponse = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 20
    if ($siteResponse.StatusCode -ne 200) {
        throw "Site verification failed with HTTP $($siteResponse.StatusCode)."
    }

    Write-Host "Frontend OK: $siteUrl ($($siteResponse.Headers.'Content-Type'))" -ForegroundColor Green

    try {
        $apiResponse = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 20
        Write-Host "API OK: $apiUrl ($($apiResponse.status))" -ForegroundColor Green
    } catch {
        Write-Host "API check skipped/failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Deployment completed successfully." -ForegroundColor Green
} finally {
    Pop-Location

    if (!$KeepArchive -and (Test-Path $archivePath)) {
        Remove-Item -LiteralPath $archivePath -Force
    }
}
