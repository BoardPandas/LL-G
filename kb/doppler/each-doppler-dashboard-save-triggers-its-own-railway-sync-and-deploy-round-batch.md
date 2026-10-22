---
tech: doppler
tags: [railway, sync, deploy, rotation, batch]
severity: medium
---
# Each Doppler dashboard save triggers its own Railway sync and deploy round; batch edits into one save

## PROBLEM
With a Doppler -> Railway sync, every separate save in the Doppler dashboard is its own sync and its own Railway deploy round across all synced services.
Rotating several secrets one save at a time queues overlapping deploys; Railway can briefly show several active deployments per service, some running with a half-rotated set of values (e.g. new DB password, old DB URL).

## WRONG
```text
Edit SECRET_A -> Save   (deploy round 1)
Edit SECRET_B -> Save   (deploy round 2, overlaps 1)
Edit SECRET_C -> Save   (deploy round 3, overlaps 2)
```

## RIGHT
```text
Edit SECRET_A, SECRET_B, SECRET_C in the same editor session -> one Save
(or one `doppler secrets set A=... B=... C=...` / one API change_requests call)
-> one sync -> one deploy round
```

## NOTES
- After the round, check each service has exactly one active deployment before the next change.
- Values that must change together (password + URL containing it) must be in the same save.
