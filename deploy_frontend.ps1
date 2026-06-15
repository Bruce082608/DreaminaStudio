# Dreamina Studio Frontend Deployment Script
# Targets Server: 43.129.24.162
# Local OS: Windows PowerShell

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "🚀 Dreamina Studio - Frontend Builder & Deployer" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Step 1: Run npm build
Write-Host "`nStep 1: Running local production build..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Build failed! Please resolve compile errors before deploying." -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "`n✓ Local build completed successfully!" -ForegroundColor Green

# Target details
$SERVER_IP = "43.129.24.162"
$REMOTE_DIR = "/var/www/dreamina_studio"
$NGINX_CONF_DIR = "/etc/nginx/conf.d"

Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host "🎯 Remote Deployment Guides & Commands" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Run the following commands in your shell to complete the deployment:" -ForegroundColor White

Write-Host "`n[1] Create remote directory (if not exists):" -ForegroundColor Green
Write-Host "ssh root@$SERVER_IP `"mkdir -p $REMOTE_DIR`"" -ForegroundColor Yellow

Write-Host "`n[2] Upload static frontend files (Vite output):" -ForegroundColor Green
Write-Host "scp -r dist/* root@$SERVER_IP`:$REMOTE_DIR/" -ForegroundColor Yellow

Write-Host "`n[3] Upload Nginx configuration file:" -ForegroundColor Green
Write-Host "scp dreamina_studio.conf root@$SERVER_IP`:$NGINX_CONF_DIR/" -ForegroundColor Yellow

Write-Host "`n[4] Test Nginx configuration and reload Nginx server:" -ForegroundColor Green
Write-Host "ssh root@$SERVER_IP `"nginx -t && systemctl reload nginx || systemctl restart nginx`"" -ForegroundColor Yellow

Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host "💡 Tip: If you use a custom SSH key, append '-i path/to/key' to the ssh/scp commands." -ForegroundColor Gray
Write-Host "=========================================" -ForegroundColor Cyan
