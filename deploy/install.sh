#!/usr/bin/env bash
# Installs or updates the pull deploy on the production host, from the checkout:
#   sudo deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")"

install -m 0755 lala-pull /usr/local/bin/lala-pull
install -m 0644 lala-pull.service lala-pull.timer /etc/systemd/system/
install -d -o deploy -g deploy /var/lib/lala-pull
systemctl daemon-reload
systemctl enable --now lala-pull.timer
