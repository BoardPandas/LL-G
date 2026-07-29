---
tech: claude-code
tags: [hooks, matcher, bash, git, self-filter, settings-json, false-negative]
severity: high
---
# A regex cannot decide whether a Bash hook command is `git commit` -- walk argv

## PROBLEM

Once you fix the matcher-is-a-tool-name bug (see `hook-matcher-tool-names-only.md`), your
commit hook is attached to matcher `"Bash"` and therefore fires on *every* bash command. The
script has to decide for itself whether the command is a `git commit`. The obvious move is a
regex, and every regex you will reach for is wrong in one of two directions -- both silent.

Tighten it so "flags are tokens starting with `-`":

    git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit

and it **misses `git -C /repo commit`**. Git's global flags `-C`, `-c`, `--git-dir`,
`--work-tree`, `--namespace`, `--exec-path` and `--super-prefix` take their value as a
*separate* argv token, so `/repo` sits between `-C` and `commit` and the alternation cannot
consume it. The guard returns false, the hook exits 0, and the commit sails through. This is
the dangerous direction: a blocking guardrail that silently stops guarding, which looks
exactly like a guardrail that simply has not been triggered yet.

Loosen it to allow arbitrary tokens between `git` and `commit` and you break the other way:
`git log --grep=commit`, `git log -1 --pretty=format:"commit"` and `git config --get
commit.gpgsign` all match, so a blocking hook now refuses read-only commands.

There is no middle regex. The predicate is positional -- "is `commit` the first token after
`git` that is not a flag or a flag's value" -- and that is argv parsing, not pattern matching.

## WRONG

```bash
# PreToolUse, matcher "Bash". Must self-filter, so:
is_git_commit() {
  printf '%s' "${1-}" \
    | grep -qE '(^|[^[:alnum:]_-])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
}

# git commit -m "x"              -> match   (ok)
# git -C /repo commit -F .git/M  -> NO MATCH  <-- guard silently skipped
# git -c user.name=x commit      -> NO MATCH  <-- guard silently skipped
#
# Loosening the middle to [^[:space:]]+ instead fixes those two and then:
# git log --grep=commit          -> match     <-- blocking hook refuses a read
```

## RIGHT

```bash
# Token-walk argv: find `git`, skip flags (consuming a value for the flags that
# take one), and test whether the first non-flag token is `commit`.
is_git_commit() {
  local cmd="${1-}"
  local -a toks
  set -f                    # tokens like *.ts must not glob-expand
  # shellcheck disable=SC2206
  toks=($cmd)
  set +f

  local n=${#toks[@]} i=0 j tok
  while [ "$i" -lt "$n" ]; do
    if [ "${toks[$i]}" = "git" ]; then
      j=$((i + 1))
      while [ "$j" -lt "$n" ]; do
        tok="${toks[$j]%%[;&|]*}"        # drop a trailing shell separator
        case "$tok" in
          # global flags whose value is the NEXT token
          -C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)
            j=$((j + 2)) ;;
          -*)      j=$((j + 1)) ;;
          commit)  return 0 ;;
          *)       break ;;              # some other subcommand, e.g. `git log`
        esac
      done
    fi
    i=$((i + 1))
  done
  return 1
}
```

Verified against, in order: `git commit -m "x"`, `git -C /repo commit -F .git/MSG`,
`git -c user.name=x commit --amend`, `cd apps/web && git commit -m "y"`,
`git --git-dir=/r/.git commit`, `git commit;`, `git add . && git commit -m "z"` -> all match;
`git log --grep=commit`, `git log -1 --pretty=format:"commit"`, `git status`, `git push`,
`grep -r commit .`, `ls -la` -> none match.

## NOTES

- **Get the command from stdin, not from a variable.** The payload is JSON on stdin;
  `tool_input.command` is the field. There is no environment variable holding it (the
  same trap as `$CLAUDE_FILE_PATH` -- see `hook-empty-path-formats-repo.md`).
- **Test by piping payloads, not by reasoning.** `printf '%s' "$payload" | bash hook.sh; echo $?`
  against both a positive and a negative case takes seconds and is the only thing that
  distinguishes "guard is correct" from "guard is silently inert". A hook you have never
  executed is a hook you have no evidence about.
- **The same shape applies to any argv predicate in a `Bash` hook** -- blocking `rm -rf`,
  gating `terraform apply`, detecting `npm publish`. Flags-with-separate-values is the
  general case, not a git quirk.
- Avoid `\b` in the pattern if you keep any regex nearby: GNU grep, BSD grep and ugrep are
  all in play across dev machines and their word-boundary support differs.
- Related: `hook-matcher-tool-names-only.md` (why the matcher is `"Bash"` in the first
  place) and `cursor-frontmatter-keys-ignored.md` (the sibling silent-scoping failure).
