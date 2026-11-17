---
tech: railway
tags: [railway-cli, scale, replicas, regions, egress-ip, stop-service]
severity: high
---
# `railway scale <region>=0` does not stop a service, and scaling back up adds a second region

## PROBLEM
`railway scale <region>=0` reads like "stop this service", and the CLI's own help shows `<region>=0`. It did not stop the service:
- it wrote that region as `null` in the service's region map;
- it triggered fresh deployments, and those went live and kept serving.

Scaling back with `railway scale <region>=1` then made it worse. It set the region back to one replica, and the service also gained a replica in a second region, the default one.
That replica boots with different egress IPs. Anything allow-listed by source IP (a database firewall, a secrets manager's trusted IPs, a partner API) then fails for part of the traffic, which looks intermittent rather than misconfigured.

## WRONG
```bash
railway scale -s <service> <region>=0   # region written as null, new deployment goes live
railway scale -s <service> <region>=1   # <region> AND the default region now each run a replica
```

## RIGHT
```bash
# Stop: remove the live deployment
railway down -y -s <service>

# Restore: name the region you want AND zero the one Railway would otherwise add
railway scale -s <service> <region>=1 <otherRegion>=0
```
Then re-read the region map (for example with the Railway agent's describe-service) and confirm exactly one region has replicas. "The service is up" does not tell you how many regions it is up in.

## NOTES
- `railway down` removes the live deployment only once that deployment has finished building. Run it again, or wait, if a build is still in progress.
- After a region change, check egress-dependent allow lists from the new replica, not from the one that was already working.
