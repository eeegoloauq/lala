# Prod host recipe

Prod is an unprivileged LXD container (`egor`) on an Oracle Ampere arm64 host,
outside the home network: Forgejo and its registry are unreachable from there,
so the branch comes from the GitHub mirror and the images from GHCR.

    # git 2.43 on this image gets a 401 from GitHub on the HTTP/2
    # git-upload-pack POST; plain GETs are fine. Upstream workaround:
    git config --system http.version HTTP/1.1
    apt install docker-ce docker-ce-cli containerd.io docker-compose-plugin
    docker network create edge          # shared with the box's proxy stack
    git clone https://github.com/eeegoloauq/lala.git /opt/lala   # owner: deploy
    cp .env.example /opt/lala/.env                               # fill in, LALA_REGISTRY=ghcr.io/eeegoloauq
    install -m755 deploy/lala-pull deploy/lala-deploy.sh /usr/local/bin/
    install -m644 deploy/lala-pull.{service,timer} /etc/systemd/system/
    systemctl enable --now lala-pull.timer

TLS and the public names are not in this stack: nginx-proxy-manager runs in
/opt/npm on the same box, holds 80/443, and proxies `web:80` and `livekit:7880`
over the `edge` network. Ports the host forwards to the container: 80, 443,
7881/tcp, 50000/udp, 3478/udp. 7880 is not among them.
