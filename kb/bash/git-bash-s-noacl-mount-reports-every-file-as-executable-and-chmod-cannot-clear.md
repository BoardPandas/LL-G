---
tech: bash
tags: [git-bash, msys, windows, chmod, execute-bit, testing]
severity: high
---
# Git Bash's noacl mount reports every #! file as executable, and chmod cannot clear it

## PROBLEM
On Git Bash's default NTFS mount (`noacl`), `[ -x file ]` is true for any file that starts with `#!`, and `chmod 644` (from bash or Node `fs.chmodSync`) does not change that.
A guard keyed on `-x` cannot reject a non-executable script there, and a test that sets one up and expects rejection fails on Windows while passing on macOS and Linux. Check `mount`: entries show `(binary,noacl,...)`.

## WRONG
```js
writeFileSync(rt, "#!/bin/sh\nexit 0\n");
chmodSync(rt, 0o644);
assertRejected(rt); // fails on Git Bash: bash still sees it as executable
```

## RIGHT
```js
// Probe whether this filesystem can clear an execute bit, and skip with a reason if not.
function clearsExecBit() {
  const dir = mkdtempSync(join(tmpdir(), "exec-probe-"));
  try {
    const f = join(dir, "probe");
    writeFileSync(f, "#!/bin/sh\nexit 0\n");
    chmodSync(f, 0o644);
    return spawnSync("bash", ["-c", '[ ! -x "$1" ]', "probe", f]).status === 0;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const noExecBit = !clearsExecBit() && "filesystem cannot clear an execute bit (Git Bash noacl mount)";
test("rejects a script without the execute bit", { skip: noExecBit }, () => { /* ... */ });
```

## NOTES
Probe the behaviour rather than checking `process.platform`: a Cygwin mount with `acl` does honour modes. Put the no-exec case in its own test, so skipping it does not hide the other assertions.
