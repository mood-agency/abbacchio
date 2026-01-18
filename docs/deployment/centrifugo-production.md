# Centrifugo Production Deployment Guide

This guide covers deploying Centrifugo with Redis backend, Nginx reverse proxy, and SSL/TLS for production environments.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Nginx Reverse Proxy](#nginx-reverse-proxy)
- [SSL/TLS Setup](#ssltls-setup)
- [Scaling](#scaling)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
                         ┌─────────────────────────────────────────────┐
                         │              Load Balancer                  │
                         │         (nginx + Let's Encrypt)             │
                         └──────────────────┬──────────────────────────┘
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    │                       │                       │
              ┌─────┴─────┐           ┌─────┴─────┐           ┌─────┴─────┐
              │  API #1   │           │  API #2   │           │  API #N   │
              │  (Hono)   │           │  (Hono)   │           │  (Hono)   │
              └─────┬─────┘           └─────┬─────┘           └─────┬─────┘
                    │                       │                       │
                    └───────────────────────┼───────────────────────┘
                                            │
                         ┌──────────────────┴──────────────────┐
                         │           Centrifugo Cluster        │
                         │     (WebSocket + HTTP Streaming)    │
                         └──────────────────┬──────────────────┘
                                            │
                         ┌──────────────────┴──────────────────┐
                         │              Redis                  │
                         │    (Pub/Sub + Presence + History)   │
                         └─────────────────────────────────────┘
```

### Components

| Component | Purpose | Port |
|-----------|---------|------|
| Nginx | Reverse proxy, SSL termination, load balancing | 80, 443 |
| Centrifugo | Real-time WebSocket server | 8000 (internal) |
| Redis | Message broker, presence, history persistence | 6379 (internal) |
| API Server | Log ingestion and token generation | 3000 (internal) |

---

## Prerequisites

- Docker and Docker Compose v2+
- Domain name pointing to your server
- Open ports: 80 (HTTP), 443 (HTTPS)
- Minimum 1GB RAM (2GB recommended)

---

## Quick Start

### 1. Clone and Navigate

```bash
cd pino-live
```

### 2. Create Environment File

```bash
cp centrifugo.env.example .env
```

### 3. Generate Secure Secrets

```bash
# Generate token secret (for JWT client authentication)
echo "CENTRIFUGO_TOKEN_SECRET=$(openssl rand -hex 32)" >> .env

# Generate API key (for server-to-Centrifugo communication)
echo "CENTRIFUGO_API_KEY=$(openssl rand -hex 32)" >> .env
```

### 4. Configure Allowed Origins

Edit `centrifugo.prod.json` and add your production domains:

```json
{
  "client": {
    "allowed_origins": [
      "https://yourdomain.com",
      "https://app.yourdomain.com"
    ]
  }
}
```

### 5. Start Services

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 6. Verify Deployment

```bash
# Check health endpoint
curl http://localhost:8000/health

# Check all containers are running
docker-compose -f docker-compose.prod.yml ps
```

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CENTRIFUGO_TOKEN_SECRET` | Yes | JWT signing secret (min 32 chars) |
| `CENTRIFUGO_API_KEY` | Yes | API authentication key (min 32 chars) |
| `CENTRIFUGO_PORT` | No | External port (default: 8000) |
| `CENTRIFUGO_ADMIN_PASSWORD` | No | Admin UI password |
| `CENTRIFUGO_ADMIN_SECRET` | No | Admin token secret |

### Centrifugo Configuration

Key settings in `centrifugo.prod.json`:

```json
{
  "broker": "redis",
  "redis_address": "redis://redis:6379",
  "presence_manager": "redis",

  "channel": {
    "namespaces": [{
      "name": "logs",
      "presence": true,
      "history_size": 100,
      "history_ttl": "5m",
      "force_recovery": true
    }]
  },

  "websocket": {
    "compression": true,
    "compression_min_size": 128
  },

  "prometheus": true,
  "health": true
}
```

### Channel Namespace Settings

| Setting | Value | Description |
|---------|-------|-------------|
| `presence` | `true` | Track connected clients per channel |
| `history_size` | `100` | Messages to keep for recovery |
| `history_ttl` | `5m` | How long to retain history |
| `force_recovery` | `true` | Auto-recover missed messages on reconnect |
| `allow_publish_for_client` | `false` | Clients cannot publish (server only) |

---

## Nginx Reverse Proxy

### Basic Configuration

Create `/etc/nginx/sites-available/pino-live`:

```nginx
# Upstream definitions
upstream centrifugo {
    server 127.0.0.1:8000;
    keepalive 64;
}

upstream api {
    server 127.0.0.1:3000;
    keepalive 32;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com;

    # SSL certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL configuration
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # Modern TLS configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # Centrifugo WebSocket endpoint
    location /connection/websocket {
        proxy_pass http://centrifugo;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket specific timeouts
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_connect_timeout 60s;

        # Disable buffering for WebSocket
        proxy_buffering off;
    }

    # Centrifugo SSE/HTTP streaming endpoint
    location /connection/http_stream {
        proxy_pass http://centrifugo;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE specific settings
        proxy_read_timeout 3600s;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
    }

    # Centrifugo SSE endpoint
    location /connection/sse {
        proxy_pass http://centrifugo;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 3600s;
        proxy_buffering off;
        proxy_cache off;
    }

    # API endpoints
    location /api/ {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        # API timeouts
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

    # Dashboard static files (if serving from same domain)
    location / {
        root /var/www/pino-live/dashboard;
        try_files $uri $uri/ /index.html;

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

### Enable Configuration

```bash
sudo ln -s /etc/nginx/sites-available/pino-live /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## SSL/TLS Setup

### Option 1: Let's Encrypt with Certbot (Recommended)

```bash
# Install Certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Verify auto-renewal
sudo certbot renew --dry-run
```

Certbot will automatically:
- Obtain SSL certificates
- Configure Nginx
- Set up auto-renewal (cron job)

### Option 2: Docker with Certbot

Add to `docker-compose.prod.yml`:

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/sites:/etc/nginx/sites-enabled:ro
      - ./certbot/www:/var/www/certbot:ro
      - ./certbot/conf:/etc/letsencrypt:ro
    depends_on:
      - centrifugo
    networks:
      - pino-live-network
    restart: unless-stopped

  certbot:
    image: certbot/certbot
    volumes:
      - ./certbot/www:/var/www/certbot
      - ./certbot/conf:/etc/letsencrypt
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done;'"
    networks:
      - pino-live-network
```

Initial certificate setup:

```bash
# Create directories
mkdir -p certbot/www certbot/conf nginx/sites

# Get initial certificate
docker-compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  -d yourdomain.com \
  --email your@email.com \
  --agree-tos \
  --no-eff-email
```

### Option 3: Self-Signed (Development/Testing Only)

```bash
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -subj "/CN=localhost"
```

---

## Scaling

### Horizontal Scaling with Multiple Centrifugo Nodes

Redis enables running multiple Centrifugo instances:

```yaml
# docker-compose.prod.yml
services:
  centrifugo-1:
    image: centrifugo/centrifugo:v6
    # ... same config

  centrifugo-2:
    image: centrifugo/centrifugo:v6
    # ... same config

  centrifugo-3:
    image: centrifugo/centrifugo:v6
    # ... same config
```

Update Nginx upstream:

```nginx
upstream centrifugo {
    least_conn;
    server centrifugo-1:8000;
    server centrifugo-2:8000;
    server centrifugo-3:8000;
    keepalive 64;
}
```

### Redis Sentinel (High Availability)

For Redis high availability:

```yaml
services:
  redis-master:
    image: redis:7-alpine
    command: redis-server --appendonly yes

  redis-replica:
    image: redis:7-alpine
    command: redis-server --replicaof redis-master 6379

  redis-sentinel:
    image: redis:7-alpine
    command: redis-sentinel /etc/redis/sentinel.conf
```

Update `centrifugo.prod.json`:

```json
{
  "redis_address": "redis-sentinel://redis-sentinel:26379/mymaster"
}
```

### Capacity Planning

| Concurrent Users | Centrifugo Nodes | Redis Memory | API Servers |
|------------------|------------------|--------------|-------------|
| 100-500 | 1 | 256MB | 1 |
| 500-2,000 | 2 | 512MB | 2 |
| 2,000-10,000 | 3-5 | 1GB | 3-4 |
| 10,000+ | 5+ | 2GB+ (cluster) | 5+ |

---

## Monitoring

### Prometheus Metrics

Centrifugo exposes metrics at `/metrics`:

```bash
curl http://localhost:8000/metrics
```

Key metrics to monitor:

| Metric | Description |
|--------|-------------|
| `centrifugo_node_num_clients` | Current connected clients |
| `centrifugo_node_num_channels` | Active channels |
| `centrifugo_node_num_messages_sent` | Messages sent |
| `centrifugo_node_num_messages_received` | Messages received |
| `centrifugo_transport_connect_duration_seconds` | Connection latency |

### Grafana Dashboard

Import the official Centrifugo Grafana dashboard:
- Dashboard ID: `13039`
- URL: https://grafana.com/grafana/dashboards/13039

### Health Checks

```bash
# Centrifugo health
curl http://localhost:8000/health

# Redis health
docker exec pino-live-redis redis-cli ping

# Full stack check
curl -f http://localhost:8000/health && \
docker exec pino-live-redis redis-cli ping && \
echo "All systems operational"
```

### Alerting

Recommended alerts:

```yaml
# prometheus/alerts.yml
groups:
  - name: centrifugo
    rules:
      - alert: CentrifugoDown
        expr: up{job="centrifugo"} == 0
        for: 1m

      - alert: HighConnectionCount
        expr: centrifugo_node_num_clients > 5000
        for: 5m

      - alert: RedisDown
        expr: redis_up == 0
        for: 1m
```

---

## Troubleshooting

### Common Issues

#### WebSocket Connection Fails

**Symptoms:** Clients can't connect via WebSocket

**Check:**
```bash
# Verify Centrifugo is running
docker logs pino-live-centrifugo

# Test WebSocket endpoint
wscat -c ws://localhost:8000/connection/websocket
```

**Solutions:**
- Ensure `allowed_origins` includes your domain
- Check Nginx WebSocket headers (`Upgrade`, `Connection`)
- Verify firewall allows WebSocket connections

#### Token Authentication Fails

**Symptoms:** "invalid token" errors

**Check:**
```bash
# Verify secret matches between API and Centrifugo
echo $CENTRIFUGO_TOKEN_SECRET
```

**Solutions:**
- Ensure same secret in API and Centrifugo configs
- Check token expiration (`exp` claim)
- Verify token algorithm is `HS256`

#### Redis Connection Issues

**Symptoms:** Centrifugo can't connect to Redis

**Check:**
```bash
# Test Redis connection
docker exec pino-live-redis redis-cli ping

# Check Centrifugo logs
docker logs pino-live-centrifugo | grep -i redis
```

**Solutions:**
- Verify Redis is running and healthy
- Check `redis_address` in config
- Ensure containers are on same network

#### High Memory Usage

**Symptoms:** OOM errors or slow performance

**Check:**
```bash
# Check container memory
docker stats pino-live-centrifugo pino-live-redis
```

**Solutions:**
- Reduce `history_size` and `history_ttl`
- Lower `client_queue_max_size`
- Scale horizontally instead of vertically

### Debug Mode

Enable debug logging temporarily:

```json
{
  "log_level": "debug"
}
```

```bash
docker-compose -f docker-compose.prod.yml restart centrifugo
docker logs -f pino-live-centrifugo
```

### Useful Commands

```bash
# View real-time logs
docker-compose -f docker-compose.prod.yml logs -f

# Restart all services
docker-compose -f docker-compose.prod.yml restart

# Check Redis memory usage
docker exec pino-live-redis redis-cli INFO memory

# List connected clients (requires admin)
curl -X POST http://localhost:8000/api/info \
  -H "Authorization: apikey YOUR_API_KEY"

# Force disconnect all clients (emergency)
curl -X POST http://localhost:8000/api/disconnect \
  -H "Authorization: apikey YOUR_API_KEY" \
  -d '{"user": ""}'
```

---

## Security Checklist

- [ ] Generated secure random secrets (32+ characters)
- [ ] Set `allowed_origins` to specific domains only
- [ ] SSL/TLS enabled with valid certificates
- [ ] Redis not exposed to public internet
- [ ] API key rotated regularly
- [ ] Admin interface disabled or password protected
- [ ] Rate limiting configured on Nginx
- [ ] Firewall rules restrict internal ports
- [ ] Regular security updates applied

---

## Next Steps

1. **Set up monitoring**: Deploy Prometheus + Grafana
2. **Configure backups**: Redis RDB/AOF backups
3. **Load testing**: Test with expected concurrent users
4. **CI/CD**: Automate deployments
5. **Documentation**: Document runbooks for on-call

For more information:
- [Centrifugo Documentation](https://centrifugal.dev/)
- [Redis Documentation](https://redis.io/docs/)
- [Nginx Documentation](https://nginx.org/en/docs/)
