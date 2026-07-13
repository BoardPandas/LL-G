---
tech: docker
tags: [docker-compose, exec, ssh, heredoc, stdin, bash]
severity: medium
---
# `docker compose exec -T` inside an ssh heredoc eats the rest of the script

## PROBLEM
When you run a remote script via `ssh host 'bash -s' <<'EOF' ... EOF`, the remote shell's stdin IS the heredoc body. Any command inside that reads stdin -- notably `docker compose exec -T` (and `docker exec -i`, `psql` with no `-c/-f`, `cat`, etc.) -- will CONSUME the remaining heredoc lines as its own stdin. The commands after it silently never run. The symptom looks like the script hung or the output was truncated mid-way; there is no error. Multi-step remote provisioning (restore DBs, run migrations, verify) dies after the first `exec` and you chase phantom failures.

## WRONG
```bash
ssh host 'bash -s' <<'EOF'
docker compose exec -T pg-app pg_restore -d app /tmp/app.dump   # eats the lines below
docker compose exec -T pg-app psql -d app -c 'select count(*)'  # never runs
echo "done"                                                     # never runs
EOF
```

## RIGHT
```bash
ssh host 'bash -s' <<'EOF'
docker compose exec -T pg-app pg_restore -d app /tmp/app.dump </dev/null
docker compose exec -T pg-app psql -d app -c 'select count(*)' </dev/null
echo "done"
EOF
# Or: write the script to a file, scp it, and run `bash script.sh </dev/null`.
```

## NOTES
Redirect every stdin-reading command from `/dev/null` (unless you are intentionally piping the heredoc into it). Writing the whole script to a file and executing it with stdin detached is the more robust pattern for anything non-trivial. The same trap applies to `kubectl exec -i`, `ssh -tt`, and any tool that opens stdin.
