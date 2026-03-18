# API Contract

All routes are versioned under `/api/v1/`. Agents authenticate with `X-Api-Key: <key>`.

---

## Health

```
GET /health
→ 200 { "status": "ok", "version": "0.1.0" }
```

---

## Agents

### Register
```
POST /api/v1/agents/register
Body: { "hostname": "my-server", "capabilities": ["sys.metrics"] }
→ 201 { "agent_id": "<32-char hex>", "api_key": "<plaintext — shown once>" }
```

### List
```
GET /api/v1/agents
→ 200 [ { id, hostname, capabilities, registered_at, last_seen, online }, ... ]
```

### Get one
```
GET /api/v1/agents/{agent_id}
→ 200 AgentInfo | 404
```

### Remove
```
DELETE /api/v1/agents/{agent_id}
Headers: X-Api-Key: <agent_key>
→ 204 | 401
```

---

## Metrics

### Ingest (agent → backend)
```
POST /api/v1/metrics
Headers: X-Api-Key: <agent_key>
Body: {
  "agent_id": "<32-char hex>",
  "metrics": [
    { "name": "sys.cpu.percent", "value": 42.1, "unit": "%", "timestamp": "2026-03-15T10:00:00Z" }
  ]
}
→ 202 { "accepted": 7 }
```
- `timestamp` is optional — backend uses server time if omitted.
- Max 100 points per request.
- Rate limited: 60 req/min per IP.

### Query (dashboard → backend)
```
GET /api/v1/metrics/{agent_id}?metric=sys.cpu.percent&from=2026-03-15T00:00:00Z&limit=200
→ 200 [ { agent_id, name, value, unit, timestamp }, ... ]
```

---

## Metric names (Phase 1)

| Name | Unit | Description |
|---|---|---|
| `sys.cpu.percent` | % | Overall CPU usage |
| `sys.mem.percent` | % | Memory used % |
| `sys.mem.used_mb` | MB | Memory used |
| `sys.mem.total_mb` | MB | Total memory |
| `sys.disk.percent` | % | Root disk used % |
| `sys.disk.used_gb` | GB | Root disk used |
| `sys.disk.total_gb` | GB | Root disk total |
