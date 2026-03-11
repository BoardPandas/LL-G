# Add Learning Lessons / Gotchas System to Bootstrap

## Context

The bootstrap template has no mechanism for capturing and referencing implementation gotchas. The Tech-Assistant repo proves this pattern works well: every plan ends with a gotchas checklist, and discovered lessons get routed to persistent files. We want to bring a simplified, generic version into the bootstrap so any new repo gets it automatically.

Two core behaviors:
1. CLAUDE.md tells the model "reference gotchas before working, add new ones when found"
2. Every generated plan ends with a reminder to capture gotchas

## Files to Modify

| File | Change |
|------|--------|
| `CLAUDE.md` (line 91-96) | Add gotchas rule to Planning section |
| `CLAUDE.md` (line 106) | Condense "Document failed attempts" to reclaim line budget |
| `.claude/skills/init-repo/SKILL.md` (line 142) | Enhanced debugging.md template with structure |
| `.claude/skills/init-repo/SKILL.md` (line 85-88) | Add CLAUDE.md generation instruction for gotchas |
| `.claude/skills/spec-developer/SKILL.md` (line 118-132) | Add section 9 gotchas checklist + reminder |
| `.claude/skills/plan-repo/SKILL.md` (line 241-260) | Add item 11 to plan contents + reminder |
| `.claude/skills/update-practices/SKILL.md` (line 74-78) | Add debugging.md health check bullet |

## Changes

### 1. CLAUDE.md -- Planning section (lines 91-96)

Add one bullet after line 96:

```markdown
- Every plan MUST end with a **Learning Lessons / Gotchas** section. After implementation, route discoveries to `.claude/agent-memory/debugging.md`.
```

### 2. CLAUDE.md -- Context Management (line 106)

Condense to reclaim a line:

**Before:**
```
- **Document failed attempts:** For stubborn bugs, have Claude write a document of all attempted fixes before starting a new session. New session loads the document, avoids repeating dead ends.
```

**After:**
```
- **Document failed attempts:** Write failed fixes to `.claude/agent-memory/debugging.md` before starting new sessions. Avoids repeating dead ends.
```

**Net line impact:** +1 (Planning) -0.5 (Context) = stays under 150.

### 3. init-repo SKILL.md -- Enhanced debugging.md (Step 8, line 142)

Replace the single bullet with an expanded specification:

```markdown
- `.claude/agent-memory/debugging.md` — Known gotchas and learning lessons. Initialize with this structure:

  ```markdown
  # Gotchas & Learning Lessons

  Reference this file before starting work. Add entries when you discover non-obvious behavior, surprising failures, or patterns that wasted time. Don't make the same mistakes twice.

  ## Format

  ### [Number]. [Short descriptive title]

  **Context:** When/where this occurs.
  **Problem:** What goes wrong.
  **Solution:** What to do instead.
  **Why:** Brief explanation of root cause.

  ---

  *Keep entries concise and actionable. Remove entries that no longer apply.*
  ```
```

### 4. init-repo SKILL.md -- CLAUDE.md generation (Step 6, after line 88)

Add one sub-bullet to the CLAUDE.md build instructions:

```markdown
  - Include in the Planning section: "Every plan MUST end with a Learning Lessons / Gotchas section. After implementation, route discoveries to `.claude/agent-memory/debugging.md`."
```

### 5. spec-developer SKILL.md -- Add section 9 (after line 120, before Step 4)

Add a new section to the generated spec template:

```markdown
### 9. Learning Lessons / Gotchas

After implementation, capture here:
- [ ] New patterns discovered -- add to `.claude/agent-memory/patterns.md`
- [ ] Gotchas encountered -- add to `.claude/agent-memory/debugging.md`
- [ ] Workflow improvements -- update CLAUDE.md or agent memory
- [ ] Failed approaches -- document what was tried and why it failed

*Fill in during/after implementation. Route generalizable lessons to the appropriate agent-memory file.*
```

Also update Step 5 Report (line 132) to append:

```markdown
> **Reminder:** After implementing this spec, review the "Learning Lessons / Gotchas" section and route discoveries to `.claude/agent-memory/debugging.md`.
```

### 6. plan-repo SKILL.md -- Add to plan contents (Step 8, after line 254)

Add item 11:

```
11. Learning Lessons / Gotchas checklist (to be filled during/after implementation)
```

Update Step 9 Report (line 260) to append:

```markdown
> **Reminder:** The plan includes a Learning Lessons / Gotchas section. After each phase, route discoveries to `.claude/agent-memory/debugging.md`.
```

### 7. update-practices SKILL.md -- Health check (after line 78)

Add one bullet to the "Agent memory" review section:

```
- Does `debugging.md` have the standard gotchas structure? If empty or unstructured, initialize with the template from init-repo.
```

## What We're NOT Doing

- Not modifying the user's global `planning.md` rule (outside bootstrap scope)
- Not creating domain-specific gotcha files (single `debugging.md` is enough for a template; projects can split later)
- Not adding hooks to enforce gotchas capture (over-engineering for a template)
- Not creating a new skill for gotchas management

## Verification

1. Count lines in CLAUDE.md after edits -- must be <= 150
2. Read each modified file and confirm the new sections are properly placed and formatted
3. Verify the init-repo debugging.md template renders correctly as markdown
4. Check that spec-developer and plan-repo section numbering is consistent after additions

## Learning Lessons / Gotchas

After implementation, capture here:
- [ ] New patterns discovered -- add to `.claude/agent-memory/patterns.md`
- [ ] Gotchas encountered -- add to `.claude/agent-memory/debugging.md`
- [ ] Workflow improvements -- update CLAUDE.md or agent memory
