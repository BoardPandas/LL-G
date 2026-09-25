---
tech: linux
tags: [fedora, firewalld, docker, host-networking]
severity: medium
---
# firewalld blocks a host-networked container's port until you open it

## PROBLEM
Fedora Server's default firewalld zone opens ports by number. Docker adds its own rules for published ports on bridge networks, but a container with `network_mode: host` gets none, so its port is closed to the LAN. `curl` on the host works and the other containers on the box are reachable, so the new one looks broken rather than blocked; clients see a connection timeout.

## WRONG
```bash
docker compose up -d        # network_mode: host, port 8585; LAN clients time out
```

## RIGHT
```bash
sudo firewall-cmd --zone=FedoraServer --add-port=8585/tcp
sudo firewall-cmd --permanent --zone=FedoraServer --add-port=8585/tcp
```

## NOTES
Check the zone first: `sudo firewall-cmd --list-all`. Runtime plus `--permanent` avoids a `--reload`.
