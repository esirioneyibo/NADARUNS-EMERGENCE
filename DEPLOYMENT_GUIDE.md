# NadaRuns Deployment Guide for CloudPanel (Hostinger VPS)

## Overview
This guide will help you deploy the NadaRuns backend to your Hostinger VPS with CloudPanel, and configure MongoDB Atlas for the database.

---

## Step 1: Set Up MongoDB Atlas (Free Database)

1. **Create MongoDB Atlas Account**
   - Go to https://www.mongodb.com/atlas
   - Click "Try Free" and create an account

2. **Create a Cluster**
   - Click "Build a Database"
   - Select **FREE (M0)** tier
   - Choose a cloud provider (AWS recommended)
   - Choose region closest to Finland (Frankfurt or London)
   - Click "Create Cluster"

3. **Set Up Database Access**
   - Go to "Database Access" in sidebar
   - Click "Add New Database User"
   - Username: `nadaruns_user`
   - Password: Generate a secure password (save it!)
   - Role: "Read and write to any database"
   - Click "Add User"

4. **Set Up Network Access**
   - Go to "Network Access" in sidebar
   - Click "Add IP Address"
   - Click "Allow Access from Anywhere" (or add your VPS IP for security)
   - Click "Confirm"

5. **Get Connection String**
   - Go to "Database" in sidebar
   - Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string, it looks like:
   ```
   mongodb+srv://nadaruns_user:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   - Replace `<password>` with your actual password
   - Replace the database name: `...mongodb.net/nadaruns?retryWrites=true...`

---

## Step 2: Prepare Backend for Deployment

### 2.1 Create Production .env File

Create a file named `.env.production` with:

```env
# MongoDB Atlas Connection
MONGO_URL="mongodb+srv://nadaruns_user:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/nadaruns?retryWrites=true&w=majority"
DB_NAME="nadaruns"

# JWT Configuration (CHANGE THIS!)
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production-make-it-long"

# Admin Credentials (CHANGE THIS!)
ADMIN_EMAIL="admin@nadaruns.com"
ADMIN_PASSWORD="your-secure-admin-password"

# Optional: Google Directions API Key (for real routing)
GOOGLE_DIRECTIONS_API_KEY=""
```

### 2.2 Files to Upload to Server

Upload the `/app/backend/` folder contents:
- `server.py` - Main application
- `requirements.txt` - Python dependencies
- `.env` - Environment variables (use your production values)

---

## Step 3: Deploy on CloudPanel

### 3.1 Create Python Application in CloudPanel

1. Log into CloudPanel
2. Go to "Sites" → "Add Site"
3. Select "Python Application"
4. Enter domain: `nadaruns.com`
5. Select Python version: **3.10** or **3.11**
6. Click "Create"

### 3.2 Set Up the Application

1. SSH into your server:
   ```bash
   ssh root@your-server-ip
   ```

2. Navigate to your site directory:
   ```bash
   cd /home/nadaruns.com/htdocs/nadaruns.com
   ```

3. Upload your backend files (via SFTP or git):
   ```bash
   # If using git
   git clone https://github.com/your-repo/nadaruns-backend.git .
   
   # Or upload via SFTP to this directory
   ```

4. Create virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

5. Install dependencies:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

6. Create production `.env` file:
   ```bash
   nano .env
   # Paste your production environment variables
   ```

### 3.3 Configure CloudPanel for FastAPI

1. In CloudPanel, go to your site settings
2. Go to "Vhost" tab
3. Replace the Nginx config with:

```nginx
server {
    listen 80;
    listen [::]:80;
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    
    server_name nadaruns.com www.nadaruns.com;
    
    ssl_certificate /etc/nginx/ssl-certificates/nadaruns.com.crt;
    ssl_certificate_key /etc/nginx/ssl-certificates/nadaruns.com.key;
    
    # API routes
    location /api {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
    
    # Admin dashboard (HTML version)
    location /admin-dashboard {
        proxy_pass http://127.0.0.1:8001/api/admin-dashboard;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # Root - can serve a landing page or redirect
    location / {
        return 200 'NadaRuns API Server Running';
        add_header Content-Type text/plain;
    }
}
```

### 3.4 Set Up Supervisor (Process Manager)

1. Create supervisor config:
   ```bash
   sudo nano /etc/supervisor/conf.d/nadaruns.conf
   ```

2. Add this configuration:
   ```ini
   [program:nadaruns]
   directory=/home/nadaruns.com/htdocs/nadaruns.com
   command=/home/nadaruns.com/htdocs/nadaruns.com/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001
   user=www-data
   autostart=true
   autorestart=true
   stderr_logfile=/var/log/nadaruns/error.log
   stdout_logfile=/var/log/nadaruns/access.log
   environment=PATH="/home/nadaruns.com/htdocs/nadaruns.com/venv/bin"
   ```

3. Create log directory:
   ```bash
   sudo mkdir -p /var/log/nadaruns
   sudo chown www-data:www-data /var/log/nadaruns
   ```

4. Reload supervisor:
   ```bash
   sudo supervisorctl reread
   sudo supervisorctl update
   sudo supervisorctl start nadaruns
   ```

---

## Step 4: Configure Mobile App for Production

### 4.1 Update Frontend Environment

In `/app/frontend/.env`, update:

```env
EXPO_PUBLIC_BACKEND_URL=https://nadaruns.com
```

### 4.2 Build APK/IPA

```bash
# Install EAS CLI if not installed
npm install -g eas-cli

# Login to Expo
eas login

# Build Android APK
eas build --platform android --profile preview

# Build iOS (requires Apple Developer account)
eas build --platform ios --profile preview
```

---

## Step 5: Test the Deployment

1. **Test API Health**:
   ```bash
   curl https://nadaruns.com/api/
   ```

2. **Test Admin Login**:
   ```bash
   curl -X POST https://nadaruns.com/api/auth/admin-login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@nadaruns.com","password":"your-admin-password"}'
   ```

3. **Access Admin Dashboard**:
   - Open https://nadaruns.com/admin-dashboard in browser

---

## Troubleshooting

### View Logs
```bash
# Backend logs
sudo tail -f /var/log/nadaruns/error.log
sudo tail -f /var/log/nadaruns/access.log

# Supervisor status
sudo supervisorctl status nadaruns
```

### Restart Backend
```bash
sudo supervisorctl restart nadaruns
```

### Common Issues

1. **MongoDB Connection Failed**
   - Check your MongoDB Atlas IP whitelist
   - Verify connection string is correct
   - Ensure password doesn't have special characters that need escaping

2. **502 Bad Gateway**
   - Backend isn't running: `sudo supervisorctl start nadaruns`
   - Check port conflict: `sudo lsof -i :8001`

3. **CORS Errors**
   - Backend already allows all origins for development
   - For production, update CORS in `server.py` to only allow your domain

---

## Security Recommendations

1. **Change Default Credentials**
   - Update `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`
   - Use strong, unique passwords

2. **Enable HTTPS**
   - CloudPanel should auto-provision SSL via Let's Encrypt
   - Ensure all traffic redirects to HTTPS

3. **Restrict MongoDB Access**
   - In MongoDB Atlas, change network access from "anywhere" to your VPS IP only

4. **Environment Variables**
   - Never commit `.env` to git
   - Use different credentials for production

---

## Contact & Support

For issues with this deployment, check:
- Backend logs: `/var/log/nadaruns/`
- MongoDB Atlas monitoring dashboard
- CloudPanel error logs

