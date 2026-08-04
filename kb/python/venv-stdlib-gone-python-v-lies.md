---
tech: python
tags: [virtualenv, venv, stdlib, distro-upgrade, pipenv, diagnostics, systemd]
severity: high
---
# `python -V` succeeds in a virtualenv whose stdlib is gone

## PROBLEM

Old-style `virtualenv` **copies** the interpreter binary into the venv but leaves the standard
library in the base prefix (`/usr/lib/pythonX.Y`), reached via `orig-prefix.txt` or
`pyvenv.cfg`. A distro release upgrade that removes that base Python deletes the stdlib while
leaving the copied binary sitting there, fully executable.

The trap is that `venv/bin/python -V` **still prints the version**. CPython handles `-V` and
exits before `Py_Initialize` needs the stdlib, so the single check people reach for first to
answer "is this venv still alive?" returns a confident, reassuring, and completely wrong
answer. Any real invocation dies immediately.

Worse, the breakage is time-shifted away from its cause. A process already running keeps its
interpreter and stdlib mapped, so it survives the upgrade untouched. The failure only appears
at the next restart, which may be months later at an unrelated reboot. The reboot then takes
the blame for something the release upgrade did.

## WRONG

```bash
$ /home/app/.venv/bin/python -V
Python 3.6.5
# Interpreter runs, venv declared healthy, move on.
```

## RIGHT

```bash
# Force a real interpreter startup: -V is not a health check.
$ /home/app/.venv/bin/python -c 'import sys, encodings; print(sys.prefix)'
Could not find platform independent libraries <prefix>
Could not find platform dependent libraries <exec_prefix>
Fatal Python error: Py_Initialize: Unable to get the locale encoding
ModuleNotFoundError: No module named 'encodings'

# Confirm the base prefix the venv depends on still exists.
$ cat /home/app/.venv/pyvenv.cfg 2>/dev/null || cat /home/app/.venv/lib/orig-prefix.txt
$ ls -d /usr/lib/python3.6
ls: cannot access '/usr/lib/python3.6': No such file or directory
```

## NOTES

- Signature symptom: a systemd unit whose `ExecStart` runs from the venv exits `1` in a few
  hundred milliseconds at **every** boot, with nothing useful in the journal.
- The same class hits `pipenv` / `pip` shims under `/usr/local/bin`. Those are entry-point
  scripts with a `#!/usr/bin/python3` shebang, so a Python major bump orphans the
  `site-packages` they import from and they fail with
  `ModuleNotFoundError: No module named 'pipenv'` while the file itself still exists and is
  executable. Check the shebang and the file's mtime: a shim dated years before the current
  release is a strong tell.
- `ModuleNotFoundError: No module named 'encodings'` specifically means the interpreter cannot
  find its stdlib at all. It is a startup failure, not an application import error, and it is
  not fixable with `pip install`.
- `PYTHONHOME` can sometimes limp a broken venv along, but pointing it at a different minor
  version's stdlib gives ABI mismatches on compiled extensions. Treat it as a diagnostic
  probe, not a fix.
- Recovery is a rebuild against a supported interpreter. If the application pins an
  end-of-life Python (Django 1.x/2.x on 3.6, for example), running it in a container with the
  matching base image contains the EOL runtime without holding the host back.
- Audit trigger: after any distro release upgrade, enumerate venvs
  (`find / -name pyvenv.cfg -o -name orig-prefix.txt`) and run the import test against each,
  rather than waiting for the next reboot to discover them.
