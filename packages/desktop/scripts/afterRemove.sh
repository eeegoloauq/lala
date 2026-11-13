#!/bin/bash
# Custom %postun scriptlet for the GitHub RPM (electron-builder's default calls
# update-alternatives --remove unconditionally). On an upgrade ($1 >= 1) the new package has
# already registered /opt/Lala/lala-desktop again, and removing it would delete
# /usr/bin/lala-desktop; so only on a real removal. `|| true` because the alternative may
# never have been registered, and a scriptlet must not fail a transaction.
if [ "${1:-0}" -eq 0 ]; then
    update-alternatives --remove lala-desktop /opt/Lala/lala-desktop 2>/dev/null || true
fi
