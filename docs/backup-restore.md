# Cloudflare D1 Database Backup & Restore Guide

Operational procedures for creating backups and restoring the Englizeka Cloudflare D1 database across Production and Staging environments.

---

## 1. Automated Scheduled Backups

Cloudflare D1 automatically creates automated daily snapshots for production D1 databases.
Backups are retained for 30 days automatically by Cloudflare.

To verify automatic backups:
```bash
npx wrangler d1 backup list englizeka-prod-db
```

---

## 2. Manual Backup Trigger

Before executing database schema migrations or major platform releases, trigger a manual snapshot:

```bash
# Using npm script shortcut
npm run db:backup

# Direct wrangler command for Production
npx wrangler d1 backup create englizeka-prod-db

# Direct wrangler command for Staging
npx wrangler d1 backup create englizeka-staging-db --env staging
```

---

## 3. Database Restoration Procedure

In the event of data corruption or disaster recovery, follow these steps to restore a specific backup snapshot:

### Step 1: List Available Backups
```bash
npx wrangler d1 backup list englizeka-prod-db
```
Note the Target `backup-id` (e.g. `b1a2c3d4-5678-90ab-cdef-1234567890ab`).

### Step 2: Restore Backup Snapshot
```bash
npx wrangler d1 backup restore englizeka-prod-db <backup-id>
```

### Step 3: Verify Integrity
After restoration completes, run healthcheck and query verification:
```bash
curl https://englizeka.com/api/health
```

---

## 4. Local Export / Backup to SQL File

To download an offsite copy of the D1 database into a local `.sql` file:

```bash
npx wrangler d1 export englizeka-prod-db --remote --output=./backups/d1_backup_$(date +%Y%m%d_%H%M%S).sql
```
