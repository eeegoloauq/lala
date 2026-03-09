#!/bin/bash
# Custom %postun scriptlet for RPM.
# The default electron-builder scriptlet calls update-alternatives --remove
# which fails if the alternative was never registered (e.g. fresh install of
# a version that didn't use update-alternatives). Wrap in || true so the
# scriptlet never causes a transaction failure during upgrades.
update-alternatives --remove lala-desktop /opt/Lala/lala-desktop 2>/dev/null || true
