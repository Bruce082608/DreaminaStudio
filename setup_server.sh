#!/bin/bash
# Dreamina Studio - Server All-in-One Setup Script
# Target OS: OpenCloudOS 8 / CentOS 8 / RHEL 8
# Run this script as root on the server.

set -e

echo "============================================="
echo "⚙️ Dreamina Studio - Server Automated Deployer"
echo "============================================="

# 1. Install Nginx if not exists
if ! command -v nginx &> /dev/null; then
    echo "Installing Nginx..."
    dnf install -y nginx || yum install -y nginx
fi

# Start and enable Nginx
systemctl enable nginx
systemctl start nginx

# 2. Deploy Frontend
echo "Deploying Frontend Static Assets..."
mkdir -p /var/www/dreamina_studio
cp -r dist/* /var/www/dreamina_studio/

# 3. Configure Nginx
echo "Applying Nginx Config..."
cp dreamina_studio.conf /etc/nginx/conf.d/

# Test Nginx and reload
nginx -t
systemctl reload nginx || systemctl restart nginx
echo "✓ Nginx frontend server is online at Port 80!"

# 4. Deploy Backend
echo "Deploying Backend Template..."
mkdir -p /var/www/dreamina_studio_backend
cp -r backend/* /var/www/dreamina_studio_backend/

# 5. Build and Start Docker Container
echo "Starting Backend Docker Containers..."
cd /var/www/dreamina_studio_backend

if command -v docker-compose &> /dev/null; then
    docker-compose up -d --build
elif docker compose version &> /dev/null; then
    docker compose up -d --build
else
    echo "⚠️ Warning: docker-compose or docker compose was not found."
    echo "Please make sure Docker and Docker Compose are installed, then run 'docker compose up -d --build' in /var/www/dreamina_studio_backend/"
fi

echo "============================================="
echo "🚀 Deployment Completed Successfully!"
echo "Please visit http://43.129.24.162 to check your app!"
echo "============================================="
