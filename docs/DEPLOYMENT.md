# Deployment Guide

> *From your laptop to production in 15 minutes.*  
> **Pre-release:** `npm install -g @fangai/cli` assumes packages are published to the **`@fangai`** scope. Until then, use **[Install from source](../README.md#install-from-source)** from the monorepo README and see **[`PUBLISHING.md`](./PUBLISHING.md)**.

---

## Local Development

The simplest deployment — your machine, for development and testing.

```bash
# Install
npm install -g @fangai/cli

# Wrap an agent
fang wrap "pi --mode rpc" --port 3001

# Test
fang send --port 3001 "list the files in this project"
```

**Good for:** Development, testing adapters, single-agent workflows.

**Not good for:** Multi-agent orchestration, always-on availability, team access.

---

## Multi-Agent Local

Run multiple agents on different ports, orchestrated from your code.

```bash
# Terminal 1: pi (cheap, fast)
fang wrap "pi --mode rpc" --port 3001 --name pi-agent --cost-tier cheap

# Terminal 2: claude (expensive, deep)
fang wrap "claude --print" --port 3002 --name claude-agent --cost-tier paid

# Terminal 3: local (free, offline)
fang wrap "ollama run qwen2.5-coder:32b" --port 3003 --name local-agent --cost-tier free
```

Or use `a2a.yaml` to start them all:

```yaml
# a2a.yaml
agents:
  pi:
    cli: "pi --mode rpc"
    port: 3001
    cost_tier: cheap
  claude:
    cli: "claude --print"
    port: 3002
    cost_tier: paid
  local:
    cli: "ollama run qwen2.5-coder:32b"
    port: 3003
    cost_tier: free
```

```bash
fang start
fang discover
```

**Good for:** Multi-agent workflows on a single machine.

---

## systemd (VPS / Bare Metal)

For always-on agents on a Linux server.

### Step 1: Install

```bash
npm install -g @fangai/cli
# Install your CLI agents too
npm install -g @mariozechner/pi-coding-agent
```

### Step 2: Create a Dedicated User

```bash
sudo useradd -r -s /bin/bash a2a
sudo mkdir -p /home/a2a/project
sudo chown a2a:a2a /home/a2a/project
```

### Step 3: Create Environment File

```bash
sudo -u a2a bash -c 'cat > /home/a2a/.env << EOF
ZAI_API_KEY=your-key-here
ANTHROPIC_API_KEY=your-key-here
EOF'
sudo chmod 600 /home/a2a/.env
```

### Step 4: Create Service File

```ini
# /etc/systemd/system/a2a-pi.service
[Unit]
Description=fang pi-agent
After=network.target

[Service]
Type=simple
User=a2a
Group=a2a
WorkingDirectory=/home/a2a/project
ExecStart=/usr/local/bin/fang wrap "pi --mode rpc" --port 3001 --name pi-agent --max-parallel 4
Restart=on-failure
RestartSec=5
EnvironmentFile=/home/a2a/.env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/a2a/project

[Install]
WantedBy=multi-user.target
```

### Step 5: Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable a2a-pi
sudo systemctl start a2a-pi
sudo systemctl status a2a-pi
```

### Step 6: Verify

```bash
curl http://localhost:3001/.well-known/agent.json | jq
curl http://localhost:3001/health | jq
```

### Running Multiple Agents

Create a service file for each agent:

```bash
# Copy and modify for each agent
sudo cp /etc/systemd/system/a2a-pi.service /etc/systemd/system/a2a-claude.service
sudo cp /etc/systemd/system/a2a-pi.service /etc/systemd/system/a2a-local.service

# Edit ports and commands
sudo nano /etc/systemd/system/a2a-claude.service
sudo nano /etc/systemd/system/a2a-local.service

# Enable all
sudo systemctl enable a2a-claude a2a-local
sudo systemctl start a2a-claude a2a-local
```

### Logs

```bash
journalctl -u a2a-pi -f          # follow logs
journalctl -u a2a-pi --since today
journalctl -u a2a-pi -n 100
```

---

## Docker

### Single Agent Dockerfile

```dockerfile
# Dockerfile.pi
FROM node:20-slim

# Install fang + pi
RUN npm install -g @fangai/cli @mariozechner/pi-coding-agent

# Create non-root user
RUN useradd -m a2a
USER a2a
WORKDIR /home/a2a/project

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["fang", "wrap", "pi --mode rpc", "--port", "3001", "--name", "pi-agent"]
```

```bash
docker build -t a2a-pi -f Dockerfile.pi .
docker run -d \
  -p 3001:3001 \
  -e ZAI_API_KEY=your-key \
  -v $(pwd):/home/a2a/project \
  --name pi-agent \
  a2a-pi
```

### Ollama (Local Model) Dockerfile

```dockerfile
# Dockerfile.ollama
FROM node:20-slim

# Install Fang CLI
RUN npm install -g @fangai/cli

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Create non-root user
RUN useradd -m a2a
USER a2a
WORKDIR /home/a2a/project

EXPOSE 3003

# Start Ollama, pull model, then wrap
CMD sh -c "ollama serve & sleep 5 && ollama pull qwen2.5-coder:7b && fang wrap 'ollama run qwen2.5-coder:7b' --port 3003 --name local-agent --cost-tier free"
```

---

## Docker Compose (Full Fleet)

```yaml
# docker-compose.yml
version: "3.9"

services:
  # Cheap, fast daily driver
  pi:
    build:
      context: .
      dockerfile: Dockerfile.pi
    ports:
      - "3001:3001"
    environment:
      - ZAI_API_KEY=${ZAI_API_KEY}
    volumes:
      - ./project:/home/a2a/project
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  # Expensive, deep thinker
  claude:
    build:
      context: .
      dockerfile: Dockerfile.claude
    ports:
      - "3002:3002"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - ./project:/home/a2a/project
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  # Free, local, offline
  local:
    build:
      context: .
      dockerfile: Dockerfile.ollama
    ports:
      - "3003:3003"
    volumes:
      - ./project:/home/a2a/project
      - ollama-data:/home/a2a/.ollama
    restart: unless-stopped
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]  # optional: GPU acceleration

volumes:
  ollama-data:
```

```bash
# Start the fleet
docker compose up -d

# Check health
docker compose ps
curl http://localhost:3001/health | jq
curl http://localhost:3002/health | jq
curl http://localhost:3003/health | jq

# View logs
docker compose logs -f pi
```

---

## Reverse Proxy (Production)

**Never expose fang directly to the internet.** Always use a reverse proxy.

### nginx

```nginx
# /etc/nginx/sites-available/a2a-agents
upstream pi_agent {
    server 127.0.0.1:3001;
}

upstream claude_agent {
    server 127.0.0.1:3002;
}

# Pi agent with API key auth
server {
    listen 80;
    server_name pi-agent.yourdomain.com;

    # HTTPS (use certbot for Let's Encrypt)
    # listen 443 ssl;
    # ssl_certificate /etc/letsencrypt/live/pi-agent.yourdomain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/pi-agent.yourdomain.com/privkey.pem;

    location / {
        # API key authentication
        if ($http_x_api_key != "your-secret-api-key") {
            return 401;
        }

        proxy_pass http://pi_agent;
        proxy_http_version 1.1;

        # SSE support
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy (simpler)

```caddyfile
# Caddyfile
pi-agent.yourdomain.com {
    # Auto HTTPS
    # API key auth
    @auth header X-Api-Key your-secret-api-key
    handle @auth {
        reverse_proxy localhost:3001
    }
    handle {
        respond "Unauthorized" 401
    }
}
```

---

## Kubernetes

### Deployment Manifest

```yaml
# k8s/pi-agent-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pi-agent
  labels:
    app: fang
    agent: pi
spec:
  replicas: 1
  selector:
    matchLabels:
      app: pi-agent
  template:
    metadata:
      labels:
        app: pi-agent
    spec:
      containers:
        - name: pi-agent
          image: fang/pi:latest
          ports:
            - containerPort: 3001
          env:
            - name: ZAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: a2a-secrets
                  key: zai-api-key
          livenessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            readOnlyRootFilesystem: true
---
apiVersion: v1
kind: Service
metadata:
  name: pi-agent
spec:
  selector:
    app: pi-agent
  ports:
    - port: 80
      targetPort: 3001
  type: ClusterIP
```

---

## Monitoring

### Health Checks

Every FangServer exposes `/health`:

```json
{
  "status": "ok",
  "agent": "pi-agent",
  "activeTasks": 2,
  "uptime": 86400
}
```

### Prometheus Metrics (v0.3)

Planned endpoint: `GET /metrics`

```
# HELP a2a_tasks_total Total tasks processed
# TYPE a2a_tasks_total counter
a2a_tasks_total{agent="pi-agent",status="completed"} 142
a2a_tasks_total{agent="pi-agent",status="failed"} 3

# HELP a2a_task_duration_seconds Task execution duration
# TYPE a2a_task_duration_seconds histogram
a2a_task_duration_seconds{agent="pi-agent",le="10"} 45
a2a_task_duration_seconds{agent="pi-agent",le="30"} 98
a2a_task_duration_seconds{agent="pi-agent",le="60"} 130

# HELP a2a_active_tasks Currently running tasks
# TYPE a2a_active_tasks gauge
a2a_active_tasks{agent="pi-agent"} 2
```

### Logging

FangServer logs to stdout in JSON format (structured logging):

```json
{"level":"info","ts":"2026-04-10T12:00:00Z","msg":"task submitted","taskId":"abc","agent":"pi-agent"}
{"level":"info","ts":"2026-04-10T12:00:01Z","msg":"task running","taskId":"abc","agent":"pi-agent"}
{"level":"info","ts":"2026-04-10T12:00:45Z","msg":"task completed","taskId":"abc","duration_ms":45000,"agent":"pi-agent"}
```

Compatible with: Datadog, Grafana Loki, AWS CloudWatch, Google Cloud Logging.

---

## Security Checklist

### Essential (Do This First)

- [ ] Run as dedicated user (not root)
- [ ] Reverse proxy with authentication (nginx/caddy)
- [ ] API keys in environment variables, not config files
- [ ] Restrict file system access (bind mount only project directories)
- [ ] Set `--timeout` to prevent runaway processes
- [ ] Keep CLI agents updated
- [ ] Enable HTTPS (Let's Encrypt / certbot)

### Recommended

- [ ] Network isolation (agents on internal network, proxy on edge)
- [ ] Rate limiting on reverse proxy
- [ ] Request logging for audit trail
- [ ] Secret management (Vault, AWS Secrets Manager)
- [ ] Container scanning (Trivy, Snyk)
- [ ] Regular dependency updates (Dependabot)

### Advanced

- [ ] Mutual TLS between orchestrator and agents
- [ ] IP allowlisting on reverse proxy
- [ ] Process resource limits (ulimit, cgroups)
- [ ] Read-only container filesystem
- [ ] Network policies (Kubernetes)

---

## Cost Reference

| Deployment | Monthly Cost | Notes |
|-----------|-------------|-------|
| Local machine | $0 | Development only |
| Hetzner CX22 | ~$4/mo | 2 vCPU, 4GB RAM — runs 2-3 agents |
| DigitalOcean Droplet | ~$6/mo | 1 vCPU, 1GB RAM — runs 1-2 agents |
| Hostinger KVM 4 | ~$8/mo | 4 vCPU, 16GB RAM — runs 4-6 agents |
| Fly.io | ~$5-10/mo | Auto-scaling, per-second billing |
| Railway | ~$5-10/mo | Easy deploy, per-usage |

Add model costs on top:
- GLM Pro: $30/mo (220M token quota)
- Claude Max: $200/mo
- GPT-4o: Pay per token
- Local (Ollama): $0 (after hardware)

**A full fleet on a $8/mo VPS + $30/mo GLM Pro = $38/mo for a multi-agent AI coding system.**

---

## See also

| Doc | Purpose |
| --- | --- |
| **[`PUBLISHING.md`](./PUBLISHING.md)** | npm install vs from source |
| **[`ARCHITECTURE.md`](../ARCHITECTURE.md)** | Security model, performance |
| **[`../spec/16-RELEASE-CHECKLIST.md`](../spec/16-RELEASE-CHECKLIST.md)** | Pre-production smoke |

---

*From laptop to planet. Same bridge.*
