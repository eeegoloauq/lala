#!/bin/sh
# First-time setup on the server: asks for the two domains and writes .env with fresh
# secrets, like Jitsi's gen-passwords.sh or mailcow's generate_config.sh. Then start Lala
# with `docker compose up -d`. Run it from the cloned repository: ./setup.sh
set -eu
cd "$(dirname "$0")"

if [ -e .env ]; then
    echo ".env already exists; remove it first to set up again." >&2
    exit 1
fi
command -v docker >/dev/null || { echo "Docker is not installed: https://docs.docker.com/engine/install/" >&2; exit 1; }

# Random hex of $1 bytes.
random() {
    if command -v openssl >/dev/null; then openssl rand -hex "$1"
    else od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; fi
}

ask() {
    printf '%s' "$1" >&2
    read -r answer
    echo "${answer:-$2}"
}

DOMAIN_RE='^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$'
domain() {
    while :; do
        d=$(ask "$1" "${2:-}")
        if echo "$d" | grep -Eq "$DOMAIN_RE"; then echo "$d"; return; fi
        echo "  \"$d\" is not a domain name, try again." >&2
    done
}

APP=$(domain "Domain for the app (lala.example.com): ")
RTC=$(domain "Domain for calls [rtc.$APP]: " "rtc.$APP")

# The address this server uses to reach the internet; behind NAT, type the public one instead.
GUESS=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
while :; do
    IP=$(ask "Public IP of this server [$GUESS]: " "$GUESS")
    echo "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' && break
    echo "  \"$IP\" is not an IPv4 address, try again." >&2
done

# A private server asks everyone for one password; invite links copied in the app skip it.
PRIVATE=$(ask "Keep the server private with a password? [y/N]: " "n")
ACCESS=""
case "$PRIVATE" in [yY]*) ACCESS=$(random 12) ;; esac

# LiveKit has no account to sign up for: the key and secret are made up here, and compose
# hands the same pair to LiveKit and to the API.
KEY="lala$(random 6)"
SECRET=$(random 32)
REDIS=$(random 24)

# The values are domains, an address and hex, so they are safe in these patterns.
sed -e "s|^LIVEKIT_URL=.*|LIVEKIT_URL=wss://$RTC|" \
    -e "s|^LIVEKIT_API_KEY=.*|LIVEKIT_API_KEY=$KEY|" \
    -e "s|^LIVEKIT_API_SECRET=.*|LIVEKIT_API_SECRET=$SECRET|" \
    -e "s|^NODE_IP=.*|NODE_IP=$IP|" \
    -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$REDIS|" \
    -e "s|^LIVEKIT_DOMAIN=.*|LIVEKIT_DOMAIN=$RTC|" \
    -e "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://$APP|" \
    -e "s|^LALA_ACCESS_PASSWORD=.*|LALA_ACCESS_PASSWORD=$ACCESS|" \
    .env.example > .env
chmod 600 .env
echo "Wrote .env."

# Compose attaches the web app and LiveKit to this network for a reverse proxy.
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null

cat <<EOF

Next:

1. Start Lala: docker compose up -d
2. Open ports 80, 443, 7881 (TCP) and 3478, 50000 (UDP) in the firewall.
3. Put HTTPS in front. With Caddy, this Caddyfile does it:

   $APP {
       reverse_proxy 127.0.0.1:3000
   }
   $RTC {
       reverse_proxy 127.0.0.1:7880
   }

Then open https://$APP.
EOF
if [ -n "$ACCESS" ]; then
    echo
    echo "Server password: $ACCESS (LALA_ACCESS_PASSWORD in .env)"
fi
