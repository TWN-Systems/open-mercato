# Fix Plan: F17 — Meilisearch Port 7700 Network Exposure

**Severity:** High (if default key) / Medium (custom key set, port still open)
**Status:** Not in any existing spec — infrastructure concern, not a code fix
**Confirmed live:** Port 7700 accessible on 10.0.63.14; custom key set (default rejected)
**Effort:** 5 min (firewall rule) + check docker-compose
**Spec reference:** SPEC-061 F17

---

## The Problem

Meilisearch at `10.0.63.14:7700` is reachable from the network. The operator set a non-default key (good), but:

1. **Port should not be network-accessible regardless of key strength.** A future credential leak, weak key, or brute-force would expose all indexed tenant data across all tenants.

2. **Meilisearch holds cross-tenant data.** The search index is a single Meilisearch instance shared across all tenants. Tenant isolation is enforced at the application layer only. The underlying Meilisearch instance has no tenant isolation — anyone with the master key can read all indexes.

3. **This is on a separate host (10.0.63.14)** from the app (10.0.64.14). Both should have Meilisearch network-isolated.

---

## The Fix

### Fix 1 — Firewall port 7700 (operator action)

**On the Meilisearch host (`10.0.63.14`):**
```bash
# Block port 7700 from all external sources
ufw deny 7700/tcp
# OR via iptables:
iptables -A INPUT -p tcp --dport 7700 -j DROP
```

Meilisearch should only be reachable from the application server, not from the general network.

### Fix 2 — Bind Meilisearch to localhost in docker-compose

**File:** `docker-compose.yml` or `docker-compose.fullapp.yml`

```yaml
# Current (publishes to all interfaces):
meilisearch:
  ports:
    - "7700:7700"

# Fixed (bind to localhost only):
meilisearch:
  ports:
    - "127.0.0.1:7700:7700"
```

This means Meilisearch is only reachable from processes on the same host — not from the LAN.

On the app's Docker network, containers communicate via the internal network (container name resolution) regardless of the `ports` binding. This change only affects external/host access.

### Fix 3 — Confirm non-default MEILISEARCH_MASTER_KEY is set

```bash
# On both the 10.0.63.14 and 10.0.64.14 hosts:
docker exec mercato-meilisearch-local printenv MEILI_MASTER_KEY

# Must NOT be the default: 'meilisearch-dev-key'
# If it is: generate and rotate immediately:
openssl rand -hex 32
# Set in .env: MEILISEARCH_MASTER_KEY=<new-random-key>
# Restart: docker-compose restart mercato-meilisearch-local
```

---

## Existing Coverage to NOT Duplicate

None. Not covered in any existing spec.

The `.env.example` already shows `MEILISEARCH_MASTER_KEY` — operators are expected to set it. The docker-compose `127.0.0.1:` binding is the missing piece for network isolation.

---

## Verification

```bash
# After firewall/binding fix:
# From a DIFFERENT host on the same network:
curl --max-time 5 http://10.0.63.14:7700/health
# Expected: connection refused or timeout

# From localhost on the Meilisearch host:
curl --max-time 5 http://127.0.0.1:7700/health
# Expected: {"status":"available"} (still works locally)

# From app container (Docker internal network — must still work):
docker exec open-mercato-app-1 curl http://mercato-meilisearch-local:7700/health
# Expected: {"status":"available"} (internal Docker DNS still routes correctly)
```
