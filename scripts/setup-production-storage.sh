#!/usr/bin/env bash
# ==============================================================================
# Englezika — Production Storage Setup & ACL Enforcement Script (DEP-02)
# ==============================================================================
# Usage:
#   sudo ./scripts/setup-production-storage.sh [STORAGE_PATH]
#
# Default storage path: /var/lib/englizeka/storage/private
# ==============================================================================

set -euo pipefail

STORAGE_PATH="${1:-${PRIVATE_STORAGE_DIR:-/var/lib/englizeka/storage/private}}"
SERVICE_USER="englizeka"
SERVICE_GROUP="englizeka"

echo "=== Englezika Production Storage Setup ==="
echo "Target directory: ${STORAGE_PATH}"

# 1. Create service group and user if they do not exist
if ! getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
  echo "Creating service group: ${SERVICE_GROUP}"
  groupadd -r "${SERVICE_GROUP}"
fi

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "Creating system service user: ${SERVICE_USER}"
  useradd -r -g "${SERVICE_GROUP}" -d "/var/lib/englizeka" -s /sbin/nologin -c "Englizeka Application Service" "${SERVICE_USER}"
fi

# 2. Create the target private storage directory and parents
echo "Creating storage directory hierarchy..."
mkdir -p "${STORAGE_PATH}"

# 3. Enforce strict directory ownership
echo "Setting ownership to ${SERVICE_USER}:${SERVICE_GROUP}..."
STORAGE_PARENT="$(dirname "${STORAGE_PATH}")"
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${STORAGE_PARENT}"

# 4. Enforce strict permissions (chmod 700 on dirs, chmod 600 on files)
echo "Setting directory permissions to 0700 (owner-only access)..."
chmod 700 "${STORAGE_PARENT}"
chmod 700 "${STORAGE_PATH}"

if [ -n "$(find "${STORAGE_PATH}" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  echo "Enforcing 0600 on existing private files and 0700 on subdirectories..."
  find "${STORAGE_PATH}" -type d -exec chmod 700 {} +
  find "${STORAGE_PATH}" -type f -exec chmod 600 {} +
fi

echo "=== Storage ACL Configuration Complete ==="
echo "Path: ${STORAGE_PATH}"
ls -ld "${STORAGE_PATH}"
