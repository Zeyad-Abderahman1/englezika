# Production Security Deployment Guide

**Application:** Englizeka (إنجليزيكا)  
**Target Environment:** Linux VPS (Ubuntu/Debian) / Native PostgreSQL / Standalone Node.js Cluster behind Nginx  

---

## 1. Overview & Architecture

In production, the Englizeka Next.js application runs as a standalone Node.js process bound strictly to localhost (`127.0.0.1:3000`), with an upstream Nginx reverse proxy handling TLS termination, request filtering, client IP assignment, and static caching. PostgreSQL runs as a native system service and is never exposed publicly.

```
                  +-----------------------------------+
                  |         CLIENT / BROWSER          |
                  +-----------------------------------+
                                    |
                                    | HTTPS (Port 443)
                                    v
                  +-----------------------------------+
                  |       NGINX REVERSE PROXY         |
                  |  - TLS Termination (Let's Encrypt)|
                  |  - Sets X-Real-IP $remote_addr    |
                  |  - Strips Client-Supplied Headers |
                  |  - Enforces Request Limits        |
                  +-----------------------------------+
                                    |
                                    | HTTP (127.0.0.1:3000 only)
                                    v
+-------------------------------------------------------------------------------+
|                       ENGLIZEKA NEXT.JS APPLICATION                           |
|  - Standalone Node.js Cluster (Port 3000)                                     |
|  - Reads TRUSTED_PROXY_IP_HEADER=x-real-ip for Rate Limiting                  |
|  - Emits CSP, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors   |
+-------------------------------------------------------------------------------+
             |                                              |
             | TCP (127.0.0.1:5432)                         | File System (chmod 700)
             v                                              v
+-----------------------------+               +---------------------------------+
|    POSTGRESQL 16 DATABASE   |               |     PRIVATE DISK STORAGE        |
|  - Bound to 127.0.0.1:5432  |               |  - Location: ./storage/private  |
|  - Inaccessible from Public |               |  - Owned by nodejs user         |
+-----------------------------+               +---------------------------------+
```

---

## 2. Nginx Reverse Proxy Configuration

Below is the reference Nginx configuration (`/etc/nginx/sites-available/englizeka`).

```nginx
# HTTP -> HTTPS Redirection
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;

    # Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com www.example.com;

    # SSL Certificate configuration
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Request size limits (birth certificate max size 5MB + overhead)
    client_max_body_size 8M;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # WebSocket / Upgrade Support (for Next.js streaming / real-time updates)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';

        # Host & Forwarding headers
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        # CRITICAL: Overwrite X-Real-IP with actual connection remote_addr
        # Prevents client IP spoofing in application rate limiting
        proxy_set_header X-Real-IP $remote_addr;

        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }

    # Deny direct access to hidden files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
```

---

## 3. Trusted Proxy & Real IP Configuration

### Application Rate Limiter Integration
Englizeka uses `app/lib/rate-limit.ts` to extract client IP addresses for login, registration, code redemption, and payment checkout rate limiting.

1. **When behind Nginx / Caddy:**
   - In production `.env`, configure:
     ```bash
     TRUSTED_PROXY_IP_HEADER=x-real-ip
     ```
   - Verify that Nginx sets `proxy_set_header X-Real-IP $remote_addr;` to overwrite any header sent by the client.
2. **When behind Cloudflare:**
   - In production `.env`, configure:
     ```bash
     TRUSTED_PROXY_IP_HEADER=cf-connecting-ip
     ```
   - Ensure the server firewall allows connections to port 80/443 ONLY from Cloudflare IP ranges.
3. **When no trusted proxy is configured:**
   - Leave `TRUSTED_PROXY_IP_HEADER=` empty.
   - The application automatically defaults to the safe fallback `'untrusted-client'`. It does NOT blindly trust `X-Forwarded-For`, preventing client IP spoofing attacks.

---

## 4. PostgreSQL Database Security

### Network Isolation
1. **Binding Address:**
   - On a Linux VPS, verify `/etc/postgresql/16/main/postgresql.conf` contains:
     ```conf
     listen_addresses = 'localhost'
     ```
2. **Firewall Verification:**
   - Ensure UFW/iptables blocks external access to port 5432:
     ```bash
     sudo ufw status
     # Port 5432 should NEVER appear as ALLOW from ANY
     ```
3. **Connection Security:**
   - Use a strong, randomly generated database password (e.g. 32+ alphanumeric characters).
   - Use a dedicated `NOSUPERUSER NOCREATEDB NOCREATEROLE` application role and make it the owner of the application database so migrations do not require the PostgreSQL administrator.
   - Never commit `.env` or `DATABASE_URL` with production credentials to git.

### Native PostgreSQL setup

Install and start PostgreSQL before running the application migration:

```bash
sudo apt update
sudo apt install postgresql-16
sudo systemctl enable --now postgresql
sudo -u postgres psql
```

From the administrator `psql` session, create the application role and database. Set the password interactively with `\password` so it is not stored in shell history:

```sql
CREATE ROLE englizeka LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password englizeka
CREATE DATABASE englizeka OWNER englizeka;
\\q
```

Set `DATABASE_URL` in a protected environment file outside the repository, then run `npm run db:migrate` as the application deployment user.

---

## 5. Private Storage & File Permissions

### Directory Structure
Birth certificates and sensitive student verification documents are stored in `./storage/private` outside the web root (`public/`).

### Recommended Linux Permissions
When deploying on Linux:
```bash
# Create application user
sudo useradd -r -s /bin/false englizeka-app

# Set ownership of application root and storage
sudo chown -R englizeka-app:englizeka-app /var/www/englizeka

# Restrict private storage directory to application user ONLY
sudo chmod 700 /var/www/englizeka/storage/private
```

---

## 6. HSTS & Transport Security Policy

### HSTS Strategy
1. **Default Policy:** The application sets `Strict-Transport-Security: max-age=31536000; includeSubDomains` in production responses.
2. **Preload Decision:**
   - **`preload` is NOT enabled by default.**
   - Preload permanently locks domain-wide HTTPS into browser source trees and cannot be quickly rolled back.
   - Only submit to `hstspreload.org` after the domain and all existing subdomains have operated reliably on HTTPS for at least 3 months.

---

## 7. Pre-Launch Deployment Checklist

- [ ] Domain points to server IPv4/IPv6.
- [ ] TLS certificate issued (Let's Encrypt / Certbot).
- [ ] Nginx configured with `proxy_set_header X-Real-IP $remote_addr;`.
- [ ] Production `.env` contains strong `VERIFICATION_SECRET` (24+ characters).
- [ ] Production `.env` sets `TRUSTED_PROXY_IP_HEADER=x-real-ip`.
- [ ] Production `.env` sets `APP_URL=https://your-domain.com` (no trailing slash).
- [ ] Production `.env` sets `NODE_ENV=production` and `EMAIL_TEST_MODE=false`.
- [ ] Database credentials generated and migration applied (`npm run db:migrate`).
- [ ] Directory `./storage/private` created with `chmod 700`.
- [ ] PostgreSQL port 5432 is verified bound to `localhost` and closed in firewall.
   - [ ] Application service managed via systemd with a restart policy.
