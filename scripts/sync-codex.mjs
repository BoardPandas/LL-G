#!/usr/bin/env node
//
// sync-codex.mjs -- generate Codex and Antigravity views of this repo's Claude Code config.
//
//   node scripts/sync-codex.mjs           write the mirrors
//   node scripts/sync-codex.mjs --check   write nothing; exit 1 listing every stale,
//                                         missing, or unexpected generated file
//
// Claude Code's configuration is canonical. Everything written here is derived from it:
//
//   CLAUDE.md + .claude/rules + settings.json  ->  AGENTS.md (shared by Codex & Antigravity)
//   .claude/skills/<name>/**                   ->  .agents/skills/<name>/** (shared)
//   .claude/agents/<name>.md                   ->  .codex/agents/<name>.toml + .agents/agents/<name>.md
//   .claude/rules/*.md (with paths:)           ->  .agents/rules/*.md (trigger: glob)
//   .claude/settings.json hooks                ->  .codex/hooks.json (+ config.toml) + .agents/hooks.json
//
// Hooks are NOT copied: .codex/hooks.json invokes .claude/scripts/*.sh directly, and
// .agents/hooks.json wraps the same scripts via .claude/scripts/_antigravity-hook.sh.
// Node built-ins only, no dependencies.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  AGY_DOC_CEILING,
  AGY_SKILL_CEILING,
  generateAntigravityAgents,
  generateAntigravityHooks,
  generateAntigravityReadme,
  generateAntigravityRules,
} from "./sync-antigravity.mjs";

const ROOT = process.cwd();
const CHECK = process.argv.includes("--check");
const GENERATOR = "scripts/sync-codex.mjs";
const SYNC_CMD = "npm run sync:codex";

// Antigravity truncates AGENTS.md at 24,000 B (stricter than Codex's 32 KiB default cap).
// Stay under the tighter ceiling so neither runtime drops the always-on rules at the tail.
const AGENTS_MD_CEILING = AGY_DOC_CEILING;

const MODEL_MAP = { opus: "gpt-6-sol", sonnet: "gpt-6-luna", haiku: "gpt-6-luna" };
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

const CODEX_EVENTS = new Set([
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
]);
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PermissionRequest"]);

const TOOL_MAP = {
  Bash: "Bash",
  Edit: "Edit",
  Write: "Write",
  MultiEdit: "Edit",
  Agent: "Agent",
  Task: "Agent",
  EnterPlanMode: null,
  ExitPlanMode: null,
  Read: null,
  Glob: null,
  Grep: null,
  WebFetch: null,
  WebSearch: null,
  NotebookEdit: null,
  TodoWrite: null,
};

const BELL = /^(printf|echo(\s+-e)?)\s+(['"])\\a\3$/;
const GIT_ROOT = "$(git rev-parse --show-toplevel)";
const WRITE_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|Bash)\b|^\*$/;

const failures = [];
const notCarried = [];
let written = 0;
let removed = 0;

// ------------------------------------------------------------------ utilities

const posix = (p) => p.split("\\").join("/");
const rel = (p) => posix(relative(ROOT, p));
const normalizeEol = (s) => s.replace(/\r\n/g, "\n");
const readText = (p) => normalizeEol(readFileSync(join(ROOT, p), "utf8"));
const code = (s) => `\`${s}\``;
const tomlString = (s) => JSON.stringify(s);

function gitListFiles(dir) {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", dir],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split("\0")
      .filter(Boolean)
      .map(posix)
      .filter((p) => existsSync(join(ROOT, p)));
  } catch {
    return null;
  }
}

function walk(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out.push(...walk(rel(p)));
    else out.push(rel(p));
  }
  return out;
}

const listFiles = (dir) => [...new Set(gitListFiles(dir) ?? walk(dir))].sort();

function unquote(v) {
  if (/^".*"$/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function parseFrontmatter(text, file) {
  const src = normalizeEol(text);
  const m = src.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) throw new Error(`${file}: missing YAML frontmatter`);
  const lines = m[1].split("\n");
  const data = {};
  const indented = (i) => i < lines.length && /^\s+\S/.test(lines[i]);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z][\w-]*):(?:\s+(.*))?$/);
    if (!kv) continue;
    const value = (kv[2] ?? "").trim();
    if (value === "") {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[++i].replace(/^\s+-\s+/, "").trim()));
      }
      data[kv[1]] = items.length ? items : "";
    } else if (/^[>|][-+]?$/.test(value)) {
      const parts = [];
      while (indented(i + 1)) parts.push(lines[++i].trim());
      data[kv[1]] = value.startsWith(">") ? parts.join(" ") : parts.join("\n");
    } else if (/^\[.*\]$/.test(value)) {
      data[kv[1]] = value
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else {
      let scalar = value;
      while (indented(i + 1) && !/^\s+-\s/.test(lines[i + 1])) scalar += ` ${lines[++i].trim()}`;
      data[kv[1]] = unquote(scalar);
    }
  }
  return { data, body: src.slice(m[0].length) };
}

function tomlMultiline(s) {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"""/g, '""\\"')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"""\n${escaped.endsWith("\n") ? escaped : `${escaped}\n`}"""`;
}

const asList = (v) =>
  Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];

function demoteHeadings(markdown, by) {
  let fence = null;
  return markdown
    .split("\n")
    .map((line) => {
      const f = line.match(/^\s*(```|~~~)/);
      if (f) fence = fence === null ? f[1] : fence === f[1] ? null : fence;
      if (fence !== null || f) return line;
      const h = line.match(/^(#{1,6}) (.*)$/);
      return h ? `${"#".repeat(Math.min(6, h[1].length + by))} ${h[2]}` : line;
    })
    .join("\n");
}

// ------------------------------------------------------------- write / compare

const expected = new Map();
const OWNED_DIRS = [".agents/skills", ".agents/agents", ".agents/rules", ".codex/agents"];

function emit(path, content) {
  if (expected.has(path)) throw new Error(`${path}: generated twice (conflicting sources)`);
  expected.set(path, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"));
}

const isBinary = (buf) => buf.includes(0);
const sameContent = (a, b) =>
  isBinary(a) || isBinary(b) ? a.equals(b) : normalizeEol(a.toString("utf8")) === normalizeEol(b.toString("utf8"));

function pruneEmptyDirs(dir, stopAt) {
  while (dir.startsWith(stopAt) && dir !== stopAt && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

function reconcile() {
  for (const [path, content] of expected) {
    const abs = join(ROOT, path);
    const current = existsSync(abs) ? readFileSync(abs) : null;
    if (current && sameContent(current, content)) continue;
    if (CHECK) {
      failures.push(`${path}: ${current ? "stale" : "missing"}`);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    written++;
  }
  for (const dir of OWNED_DIRS) {
    for (const path of listFiles(dir)) {
      if (expected.has(path)) continue;
      if (CHECK) {
        failures.push(`${path}: unexpected (no Claude source generates it)`);
        continue;
      }
      rmSync(join(ROOT, path));
      removed++;
      pruneEmptyDirs(dirname(join(ROOT, path)), join(ROOT, dir));
    }
  }
}

// ------------------------------------------------------------ skills + agents

function generateSkills() {
  const files = listFiles(".claude/skills");
  const skillDirs = [
    ...new Set(files.filter((p) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p)).map((p) => p.split("/")[2])),
  ];
  const skills = [];
  for (const name of skillDirs) {
    const source = `.claude/skills/${name}`;
    const target = `.agents/skills/${name}`;
    const { data, body } = parseFrontmatter(readText(`${source}/SKILL.md`), `${source}/SKILL.md`);

    if (data.name !== name) failures.push(`${source}/SKILL.md: name "${data.name}" must match its directory "${name}"`);
    if (!/^[a-z0-9-]{1,64}$/.test(name)) {
      failures.push(`${source}: skill names must be lowercase letters, digits, and hyphens (max 64)`);
    }
    const rawDesc = String(data.description ?? "").replace(/[<>]/g, "");
    if (!rawDesc) failures.push(`${source}/SKILL.md: missing description`);

    const explicitOnly = String(data["disable-model-invocation"]) === "true";
    // Antigravity ignores agents/openai.yaml and routes solely from description.
    const description = explicitOnly
      ? `Explicit command only (/${name} or $${name}) -- never invoke implicitly. ${rawDesc}`
      : rawDesc;
    if (description.length > 1024) {
      failures.push(`${source}/SKILL.md: description is ${description.length} chars; skill loaders cap it at 1024`);
    }

    const agent = typeof data.agent === "string" && data.agent ? data.agent : null;
    const forked = data.context === "fork";

    const notes = [
      `Generated from ${code(`${source}/SKILL.md`)} by ${code(GENERATOR)}. Edit the source, then run ${code(SYNC_CMD)}. Claude Code tool and command names below map to Codex and Antigravity as described in ${code("AGENTS.md")} under "Codex & Antigravity runtimes".`,
    ];
    if (explicitOnly) {
      notes.push(`Explicit only: runs when the user invokes ${code(`$${name}`)} or ${code(`/${name}`)}, never implicitly.`);
    }
    if (agent) {
      notes.push(
        `Claude Code runs this skill inside the ${code(agent)} subagent. In Codex, spawn the ${code(agent)} custom agent (${code(`.codex/agents/${agent}.toml`)}); in Antigravity, call ${code("invoke_subagent")} with ${code(`TypeName: "${agent}"`)} (${code(`.agents/agents/${agent}.md`)}) and return its summary.`,
      );
    } else if (forked) {
      notes.push(`Claude Code runs this skill in a forked subagent context. Delegate it to a subagent and return its summary.`);
    }
    if (body.includes("$ARGUMENTS")) notes.push(`${code("$ARGUMENTS")} is the text the user supplied with the skill invocation.`);

    const expandSkillDir = (s) => s.replaceAll("${CLAUDE_SKILL_DIR}", target);
    const skillMd =
      `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n` +
      `${notes.map((n) => `> ${n}`).join("\n>\n")}\n\n${expandSkillDir(body).trim()}\n`;
    const skillBytes = Buffer.byteLength(skillMd, "utf8");
    if (skillBytes > AGY_SKILL_CEILING) {
      failures.push(
        `${target}/SKILL.md would be ${skillBytes} B, over Antigravity's ${AGY_SKILL_CEILING} B skill ceiling. Move detail into ${source}/references/.`,
      );
    }
    emit(`${target}/SKILL.md`, skillMd);

    for (const file of files.filter((p) => p.startsWith(`${source}/`) && p !== `${source}/SKILL.md`)) {
      const buf = readFileSync(join(ROOT, file));
      const out = isBinary(buf) ? buf : expandSkillDir(normalizeEol(buf.toString("utf8")));
      emit(`${target}/${file.slice(source.length + 1)}`, out);
    }
    if (explicitOnly) {
      emit(
        `${target}/agents/openai.yaml`,
        `# GENERATED by ${GENERATOR} from ${source}/SKILL.md (disable-model-invocation: true).\npolicy:\n  allow_implicit_invocation: false\n`,
      );
    }
    skills.push({ name, explicitOnly });
  }
  return skills;
}

function collectAgentSources() {
  const sources = [];
  for (const file of listFiles(".claude/agents").filter((p) => /^\.claude\/agents\/[^/]+\.md$/.test(p))) {
    const { data, body } = parseFrontmatter(readText(file), file);
    const fileName = file.split("/").pop().replace(/\.md$/, "");
    if (!data.name || !data.description) {
      failures.push(`${file}: name and description are required`);
      continue;
    }
    const tools = data.tools === undefined ? null : asList(data.tools);
    const readOnly = data.permissionMode === "plan" || (tools !== null && !tools.some((t) => WRITE_TOOLS.test(t)));
    sources.push({ file, fileName, data, body, tools, readOnly });
  }
  return sources;
}

function generateCodexAgents(agentSources) {
  for (const { file, fileName, data, body, tools, readOnly } of agentSources) {
    const lines = [
      `# GENERATED by ${GENERATOR} from ${file}. Edit the source, then run ${SYNC_CMD}.`,
      `name = ${tomlString(data.name)}`,
      `description = ${tomlString(data.description)}`,
    ];
    if (MODEL_MAP[data.model]) lines.push(`model = ${tomlString(MODEL_MAP[data.model])}`);
    if (EFFORTS.has(data.effort)) lines.push(`model_reasoning_effort = ${tomlString(data.effort)}`);
    if (readOnly) lines.push(`sandbox_mode = "read-only"`);

    const notes = [
      "Codex notes (generated):",
      `- You are the Codex port of ${code(file)}; ${code("AGENTS.md")} and any nested ${code("AGENTS.md")} still apply.`,
      `- Tool names above are Claude Code's. Map them as described in ${code("AGENTS.md")} under "Codex & Antigravity runtimes".`,
    ];
    if (tools?.length) notes.push(`- Claude Code limits you to: ${tools.join(", ")}. Stay within that scope.`);
    if (data.memory === "project") {
      notes.push(
        `- Claude Code auto-loads your project memory. Here, read ${code(`.claude/agent-memory/${fileName}/MEMORY.md`)} (if it exists) and the shared files in ${code(".claude/agent-memory/")} before starting.`,
      );
    }
    if (data.isolation === "worktree") {
      notes.push(
        "- Claude Code gives you an isolated git worktree. Codex does not: you share the parent's working tree, so edit only the files you were assigned.",
      );
    }
    lines.push(`developer_instructions = ${tomlMultiline(`${body.trim()}\n\n${notes.join("\n")}\n`)}`, "");
    emit(`.codex/agents/${fileName}.toml`, lines.join("\n"));
  }
  return agentSources;
}

function collectRules() {
  return listFiles(".claude/rules")
    .filter((p) => /^\.claude\/rules\/[^/]+\.md$/.test(p))
    .map((p) => {
      const { data, body } = parseFrontmatter(readText(p), p);
      return { path: p, description: data.description, paths: asList(data.paths), body };
    });
}

// -------------------------------------------------------------------- hooks

function codexCommands(command) {
  const projectDir = /"?\$\{?CLAUDE_PROJECT_DIR\}?"?/g;
  const unix = command
    .replace(projectDir, `"${GIT_ROOT}"`)
    .replace(/(^|\s)(\.claude\/[^\s"';&|]+)/g, (_, pre, p) => `${pre}"${GIT_ROOT}/${p}"`);
  const windows = command.replace(/"?\$\{?CLAUDE_PROJECT_DIR\}?"?[/\\]/g, "");
  return unix === command ? { command } : { command: unix, commandWindows: windows };
}

const scriptOf = (command) => command.match(/(?:^|[\s"/])(\.claude\/[\w./-]+\.(?:sh|mjs|js|py))/)?.[1] ?? null;

function generateHooks(settings) {
  const out = {};
  let bell = false;
  let mirrored = 0;
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    for (const group of groups) {
      for (const handler of group.hooks ?? []) {
        const label = `${event}${group.matcher ? ` [${group.matcher}]` : ""}: ${handler.command ?? handler.type}`;
        if ((event === "Stop" || event === "Notification") && BELL.test((handler.command ?? "").trim())) {
          bell = true;
          continue;
        }
        if (!CODEX_EVENTS.has(event)) {
          notCarried.push(`${label} -- Codex has no ${event} event.`);
          continue;
        }
        if (handler.type !== "command") {
          notCarried.push(`${label} -- Codex runs only command hooks from this generator (type "${handler.type}").`);
          continue;
        }

        let matcher = group.matcher;
        if (TOOL_EVENTS.has(event) && matcher && matcher !== "*") {
          const tokens = matcher.split("|");
          const mapped = [];
          for (const t of tokens) {
            if (/^mcp__[\w.*-]+$/.test(t)) mapped.push(t);
            else if (!Object.hasOwn(TOOL_MAP, t)) {
              failures.push(`.claude/settings.json: ${event} matcher token "${t}" has no Codex mapping. Add it to TOOL_MAP in ${GENERATOR}.`);
            } else if (TOOL_MAP[t]) mapped.push(TOOL_MAP[t]);
          }
          if (mapped.length === 0) {
            notCarried.push(`${label} -- Codex has no hookable ${tokens.join("/")} tool.`);
            continue;
          }
          if (mapped.every((t) => t === "Edit" || t === "Write")) {
            const script = scriptOf(handler.command ?? "");
            const aware = script && existsSync(join(ROOT, script)) && readText(script).includes("apply_patch");
            if (!aware) {
              notCarried.push(`${label} -- Codex edits arrive as apply_patch, which this script does not parse.`);
              continue;
            }
          } else if (mapped.some((t) => t === "Edit" || t === "Write")) {
            failures.push(`.claude/settings.json: ${event} matcher "${matcher}" mixes edit and non-edit tools. Split it into separate groups.`);
            continue;
          }
          matcher = [...new Set(mapped)].join("|");
        }

        const entry = { type: "command", ...codexCommands(handler.command) };
        for (const key of ["statusMessage", "timeout", "async"]) {
          if (handler[key] !== undefined) entry[key] = handler[key];
        }
        const groupKey = matcher ?? "";
        const list = (out[event] ??= []);
        let target = list.find((g) => (g.matcher ?? "") === groupKey);
        if (!target) {
          target = matcher ? { matcher, hooks: [] } : { hooks: [] };
          list.push(target);
        }
        target.hooks.push(entry);
        mirrored++;
      }
    }
  }
  if (bell) notCarried.push("Stop/Notification terminal bell -- replaced by [tui] notifications in .codex/config.toml.");

  emit(
    ".codex/hooks.json",
    `${JSON.stringify(
      {
        description: `GENERATED by ${GENERATOR} from .claude/settings.json. Edit that file, then run ${SYNC_CMD}. Hooks run the same .claude/scripts/ as Claude Code; there is deliberately no second copy.`,
        hooks: out,
      },
      null,
      2,
    )}\n`,
  );
  return { bell, mirrored };
}

// ---------------------------------------------------------------- AGENTS.md

const denyList = (settings, tool) =>
  (settings.permissions?.deny ?? [])
    .map((rule) => rule.match(/^(\w+)\((.*)\)$/))
    .filter((m) => m && tool.includes(m[1]))
    .map((m) => code(m[2]));

function generateAgentsMd(settings, skills, rules) {
  const alwaysOn = rules.filter((r) => r.paths.length === 0);
  const scoped = rules.filter((r) => r.paths.length > 0);
  const explicitOnly = skills.filter((s) => s.explicitOnly).map((s) => code(`$${s.name}`));

  const section = [
    "---",
    "",
    "## Codex & Antigravity runtimes",
    "",
    `This file is ${code("CLAUDE.md")} plus this section, generated by ${code(GENERATOR)}. Everything above`,
    "was written for Claude Code; read it through this mapping.",
    "",
    "| Claude Code | Codex | Antigravity |",
    "|---|---|---|",
    `| ${code("CLAUDE.md")} | this file | this file |`,
    `| ${code(".claude/skills/<name>/")} (${code("/name")}) | ${code(".agents/skills/<name>/")} (${code("$name")}) | ${code(".agents/skills/<name>/")} |`,
    `| ${code(".claude/agents/<name>.md")} | ${code(".codex/agents/<name>.toml")} | ${code(".agents/agents/<name>.md")} |`,
    `| ${code(".claude/settings.json")} hooks | ${code(".codex/hooks.json")} | ${code(".agents/hooks.json")} (${code("_antigravity-hook.sh")}) |`,
    `| ${code(".claude/rules/*.md")} | inlined or indexed below | ${code(".agents/rules/*.md")} (${code("glob")}) + always-on below |`,
    `| Read / Glob / Grep | shell reads and ${code("rg")} | ${code("view_file")} / ${code("find_by_name")}, ${code("list_dir")} / ${code("grep_search")} |`,
    `| Edit / Write / Bash | ${code("apply_patch")} / ${code("Bash")} | ${code("replace_file_content")} / ${code("write_to_file")} / ${code("run_command")} |`,
    `| WebFetch / WebSearch | web tools | ${code("read_url_content")} / ${code("search_web")} |`,
    `| Agent / Task, ${code("SendMessage")} | spawn / message a subagent | ${code("invoke_subagent")}, ${code("send_message")} |`,
    `| AskUserQuestion / Plan mode | ask in chat / save plans to ${code(`${settings.plansDirectory ?? "tasks"}/`)} | ${code("ask_question")} / save plans to ${code(`${settings.plansDirectory ?? "tasks"}/`)} |`,
    "",
    `${code("AGENTS.md")}, ${code(".agents/")}, and ${code(".codex/")} are generated. Never hand-edit them: change`,
    `the Claude source and run ${code(SYNC_CMD)}. ${code("npm run check:claude")} fails while they are stale.`,
    `Codex runs project hooks after approval in ${code("/hooks")}; Antigravity loads ${code(".agents/hooks.json")} automatically.`,
  ];
  if (explicitOnly.length) {
    section.push("", `Explicit-only skills (never start them implicitly): ${explicitOnly.join(", ")}.`);
  }

  const reads = denyList(settings, ["Read"]);
  const edits = denyList(settings, ["Edit", "Write"]);
  const runs = denyList(settings, ["Bash"]);
  if (reads.length || edits.length || runs.length) {
    section.push("", "### Denied paths and commands", "", "Claude Code enforces these; Codex and Antigravity do not, so treat them as hard rules.", "");
    if (reads.length) section.push(`- Never read: ${reads.join(", ")}`);
    if (edits.length) section.push(`- Never edit: ${edits.join(", ")}`);
    if (runs.length) section.push(`- Never run: ${runs.join(", ")}`);
  }

  if (notCarried.length) {
    section.push("", "### Hooks that do not carry over to Codex", "");
    for (const n of notCarried) section.push(`- ${n}`);
    section.push(
      "",
      "Antigravity mirrors Write/Edit hooks (`pre-write-kb-check.sh`, `post-edit-format.sh`) via `TargetFile`",
      "and delivers advisory context on `PreInvocation`, but neither Codex nor Antigravity hooks `EnterPlanMode`.",
    );
  }

  if (scoped.length) {
    section.push("", "### Path-scoped rules", "", "Antigravity loads `.agents/rules/*.md` by glob; in Codex, read a matching rule before editing:", "");
    for (const r of scoped) {
      section.push(`- ${code(r.path)}${r.description ? ` -- ${r.description}` : ""}. Paths: ${r.paths.map(code).join(", ")}`);
    }
  }

  if (alwaysOn.length) {
    section.push("", "### Always-on rules");
    for (const r of alwaysOn) {
      section.push("", `Source: ${code(r.path)}.`, "", demoteHeadings(r.body.trim(), 3));
    }
  }

  const header = `<!-- GENERATED by ${GENERATOR} from CLAUDE.md and .claude/. Do not edit; run ${SYNC_CMD}. -->`;
  const content = `${header}\n\n${readText("CLAUDE.md").trim()}\n\n${section.join("\n")}\n`;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > AGENTS_MD_CEILING) {
    failures.push(
      `AGENTS.md would be ${bytes} B; Antigravity stops reading at ${AGENTS_MD_CEILING} B (Codex at 32768 B) and drops the tail. Trim CLAUDE.md or the always-on rules.`,
    );
  }
  emit("AGENTS.md", content);
  return bytes;
}

// ------------------------------------------------------- config + README

function generateConfig(bell) {
  const lines = [
    `# GENERATED by ${GENERATOR}. Do not edit; run ${SYNC_CMD}.`,
    "# Project layer: Codex loads it (and .codex/hooks.json) only for trusted projects.",
    "",
    "[features]",
    "hooks = true",
  ];
  if (bell) {
    lines.push("", "[tui]", "notifications = true", 'notification_method = "bel"');
  }
  emit(".codex/config.toml", `${lines.join("\n")}\n`);
}

function generateReadme(summary) {
  const lines = [
    "# Codex configuration (generated)",
    "",
    `Everything here, plus the root ${code("AGENTS.md")} and ${code(".agents/")} (skills + Antigravity config), is generated from`,
    `the Claude Code configuration by ${code(GENERATOR)}. Edit the Claude source, never these files, then run:`,
    "",
    "```bash",
    SYNC_CMD,
    "npm run check:claude   # fails if any generated file is stale, missing, or unexpected",
    "```",
    "",
    "| Claude Code source | Codex output |",
    "|---|---|",
    `| ${code("CLAUDE.md")}, ${code(".claude/rules/*.md")}, permission deny rules | ${code("AGENTS.md")} |`,
    `| ${code(".claude/skills/<name>/**")} | ${code(".agents/skills/<name>/**")}; ${code("agents/openai.yaml")} for explicit-only skills |`,
    `| ${code(".claude/agents/<name>.md")} | ${code(".codex/agents/<name>.toml")} |`,
    `| ${code(".claude/settings.json")} hooks | ${code(".codex/hooks.json")} (runs ${code(".claude/scripts/")} in place) |`,
    "",
    `Current output: ${summary.skills} skills, ${summary.agents} agents, ${summary.hooks} Codex hook handlers (${summary.agyHooks} Antigravity), AGENTS.md ${summary.agentsMdBytes} B.`,
    "",
    "## How the mapping works",
    "",
    `- **Models.** Claude tiers map to Codex tiers: ${Object.entries(MODEL_MAP).map(([k, v]) => `${code(k)} -> ${code(v)}`).join(", ")}.`,
    `- **Sandbox.** Agents whose Claude tool list cannot write or run commands get ${code('sandbox_mode = "read-only"')}. The rest inherit the session's sandbox.`,
    `- **Hooks.** Codex has no handler-level ${code("if")}, so every mirrored script filters its own input (via ${code("_git-commit-filter.sh")}). Paths are anchored at the git root, with a cwd-relative ${code("commandWindows")} fallback.`,
    `- **Edit hooks.** Codex edits files with ${code("apply_patch")} (${code("tool_input.command")}), so ${code("Edit|Write")} hooks mirror only once a script parses ${code("apply_patch")}. (Antigravity mirrors them in ${code(".agents/hooks.json")} via ${code("_antigravity-hook.sh")}.)`,
    `- **Trust.** Codex loads ${code(".codex/")} only for trusted projects after hook approval in ${code("/hooks")}.`,
  ];
  if (notCarried.length) {
    lines.push("", "## Not carried over", "");
    for (const n of notCarried) lines.push(`- ${n}`);
  }
  emit(".codex/README.md", `${lines.join("\n")}\n`);
}

// --------------------------------------------------------------------- main

function main() {
  const clash = readdirSync(ROOT).find((n) => n.toLowerCase() === "agents.md" && n !== "AGENTS.md");
  if (clash) {
    failures.push(
      `${clash}: collides with the generated AGENTS.md on case-insensitive filesystems. Move its content (the agent registry belongs in .claude/references/agent-registry.md) and delete it.`,
    );
  }
  for (const required of ["CLAUDE.md", ".claude/settings.json"]) {
    if (!existsSync(join(ROOT, required))) failures.push(`${required}: missing; nothing to generate from`);
  }
  if (failures.length) return;

  let settings;
  try {
    settings = JSON.parse(readText(".claude/settings.json"));
  } catch (e) {
    failures.push(`.claude/settings.json: not valid JSON (${e.message})`);
    return;
  }

  const skills = generateSkills();
  const agentSources = collectAgentSources();
  const agents = generateCodexAgents(agentSources);
  generateAntigravityAgents({ agentSources, emit, failures, generator: GENERATOR, syncCmd: SYNC_CMD });
  const rules = collectRules();
  const agyRules = generateAntigravityRules({ rules, emit, generator: GENERATOR, syncCmd: SYNC_CMD });
  const { bell, mirrored } = generateHooks(settings);
  const { mirrored: agyMirrored, agyNotCarried } = generateAntigravityHooks({
    settings,
    bellRe: BELL,
    gitRoot: GIT_ROOT,
    scriptOf,
    emit,
    failures,
    generator: GENERATOR,
  });
  const agentsMdBytes = generateAgentsMd(settings, skills, rules);
  generateConfig(bell);
  const summary = {
    skills: skills.length,
    agents: agents.length,
    rules: agyRules,
    hooks: mirrored,
    agyHooks: agyMirrored,
    agentsMdBytes,
  };
  generateReadme(summary);
  generateAntigravityReadme({ summary, agyNotCarried, emit, generator: GENERATOR, syncCmd: SYNC_CMD });
  if (failures.length) return;
  reconcile();
  return summary;
}

let summary;
try {
  summary = main();
} catch (e) {
  failures.push(e.message);
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  console.error(
    `\n${failures.length} Codex/Antigravity mirror problem(s).${CHECK ? ` Fix the source, then run ${SYNC_CMD}.` : ""}`,
  );
  process.exit(1);
}

const counts = `${summary.skills} skills, ${summary.agents} agents, ${summary.rules} glob rules, ${summary.hooks} Codex / ${summary.agyHooks} Antigravity hooks, AGENTS.md ${summary.agentsMdBytes} B`;
if (CHECK) console.log(`OK -- Codex & Antigravity mirrors current (${counts}).`);
else {
  console.log(`Codex & Antigravity mirrors regenerated (${counts}): ${written} written, ${removed} removed.`);
  for (const n of notCarried) console.log(`  Codex not carried over: ${n}`);
}
