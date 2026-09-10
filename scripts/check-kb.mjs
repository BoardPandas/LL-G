#!/usr/bin/env node
/**
 * LL-G structural guard: the defects this catches are all SILENT.
 *
 * check-index-counts.mjs keeps the master index's numbers honest. This one keeps
 * the shape honest, covering the four ways a lesson can exist and never load:
 *
 *   1. ORPHAN        -- an entry file on disk that no llms.txt lists. Nothing that
 *                       routes through the index will ever read it, which is
 *                       indistinguishable from the lesson not existing. Two were
 *                       found this way (better-auth, rust), both complete entries.
 *   2. NO FRONTMATTER-- severity recorded as prose ("## Severity: HIGH") instead of
 *                       YAML, so "load all HIGH entries" skips it. All three found
 *                       this way were HIGH.
 *   3. WRONG tech:   -- a tech key that disagrees with its folder, so tag/tech
 *                       filtering misses the shelf it actually lives on.
 *   4. BLANK BLOAT   -- CR accumulation expanding into real blank lines. The master
 *                       index went 257 -> 3071 lines this way while its content
 *                       stayed at ~173. See .gitattributes for the mechanism.
 *
 * Budget the master index by BYTES, not lines: a line budget keeps passing while
 * single lines grow to thousands of characters, which is exactly how the index got
 * to 51 KB of shelf descriptions that every session loads (kb/claude-code/
 * line-budgets-gamed-by-long-lines.md, rediscovered here the hard way).
 *
 * Node built-ins only. Exit 0 = clean, 1 = problems found.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const MASTER = "llms.txt";
const KB = "kb";
const MASTER_BUDGET_BYTES = 20000;
const SEVERITIES = new Set(["high", "medium", "low"]);
const NON_ENTRY = new Set(["README.md", "CONTRIBUTING.md", "TEMPLATE.md"]);

const errors = [];
const exists = (p) => { try { statSync(p); return true; } catch { return false; } };

if (!exists(MASTER) || !exists(KB)) {
	console.error("check-kb: run from the root of an LL-G checkout (needs ./llms.txt and ./kb/).");
	process.exit(1);
}

/**
 * Link targets on one line. Titles legitimately contain brackets -- "Bitwise -bor
 * / -shl on [byte] operands" -- so a `\[([^\]]+)\]\(...\)` title capture stops at
 * the wrong bracket and silently matches nothing, reporting a healthy entry as an
 * orphan. Match only the (target) half.
 */
const linkTargets = (line) => [...line.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => m[1]);
const isBullet = (line) => /^- (?:(?:HIGH|MEDIUM|LOW)\s+)?\[/.test(line);

const longestBlankRun = (lines) => {
	let run = 0, max = 0;
	for (const l of lines) { if (l.trim() === "") { run++; max = Math.max(max, run); } else run = 0; }
	return max;
};

// ---- master index -----------------------------------------------------------

const masterRaw = readFileSync(MASTER);
const master = masterRaw.toString("utf8");

if (masterRaw.length > MASTER_BUDGET_BYTES) {
	errors.push(
		`${MASTER}: ${(masterRaw.length / 1024).toFixed(1)} KB exceeds the ${MASTER_BUDGET_BYTES / 1000} KB budget. ` +
		`Every session loads this file; keep each line to one clause naming the technology and its scope, ` +
		`and let the shelf carry the specific gotchas.`
	);
}
if (master.includes("\r")) errors.push(`${MASTER}: contains CR bytes. See .gitattributes -- this is how the index doubles.`);
if (longestBlankRun(master.split("\n")) > 1) errors.push(`${MASTER}: has a run of 2+ consecutive blank lines (CR expansion damage).`);

const masterLinked = new Set([...master.matchAll(/\(kb\/([a-z0-9.-]+)\/llms\.txt\)/g)].map((m) => m[1]));

// ---- shelves ----------------------------------------------------------------

const techs = readdirSync(KB, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
let entryCount = 0;

for (const tech of techs) {
	const dir = join(KB, tech);
	const idxPath = join(dir, "llms.txt");

	if (!exists(idxPath)) { errors.push(`${dir}: no llms.txt, so this shelf is unreachable.`); continue; }
	if (!masterLinked.has(tech)) errors.push(`${MASTER}: no link to kb/${tech}/llms.txt -- that shelf is invisible to anything loading only the master index.`);

	const idxRaw = readFileSync(idxPath);
	const idx = idxRaw.toString("utf8");
	if (idx.includes("\r")) errors.push(`${idxPath}: contains CR bytes.`);
	if (longestBlankRun(idx.split("\n")) > 1) errors.push(`${idxPath}: has a run of 2+ consecutive blank lines (CR expansion damage).`);

	const linked = new Set();
	for (const line of idx.split("\n")) {
		if (!isBullet(line)) continue;
		for (const href of linkTargets(line)) {
			const target = join(dir, href);
			if (!exists(target)) errors.push(`${idxPath}: links ${href}, which does not exist.`);
			if (!href.includes("/")) linked.add(href); // "../other-shelf/x.md" belongs to that shelf
		}
	}

	for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
		if (NON_ENTRY.has(file)) continue;
		const rel = `${dir}/${file}`;
		if (!linked.has(file)) errors.push(`${rel}: on disk but not listed in ${idxPath}, so it never loads.`);
		entryCount++;

		const body = readFileSync(rel, "utf8");
		const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
		if (!fm) {
			errors.push(`${rel}: no YAML frontmatter. Severity written as prose is invisible to "load all HIGH entries".`);
			continue;
		}
		const field = (name) => {
			const m = new RegExp(`^${name}:[ \t]*(.*)$`, "m").exec(fm[1]);
			return m ? m[1].trim() : null;
		};
		const sev = field("severity");
		const techField = field("tech");
		if (!sev) errors.push(`${rel}: frontmatter has no severity:.`);
		else if (!SEVERITIES.has(sev.toLowerCase())) errors.push(`${rel}: severity "${sev}" is not high/medium/low.`);
		else if (sev !== sev.toLowerCase()) errors.push(`${rel}: severity "${sev}" must be lowercase.`);
		if (!techField) errors.push(`${rel}: frontmatter has no tech:.`);
		else if (techField !== tech) errors.push(`${rel}: tech "${techField}" disagrees with its folder kb/${tech}.`);
		if (field("tags") === null) errors.push(`${rel}: frontmatter has no tags:.`);
	}
}

// ---- report -----------------------------------------------------------------

console.log(`check-kb: ${techs.length} shelves, ${entryCount} entries, master index ${(masterRaw.length / 1024).toFixed(1)} KB`);
if (!errors.length) { console.log("check-kb OK: every entry is reachable and conforms to the documented frontmatter."); process.exit(0); }
console.error(`\ncheck-kb FAILED: ${errors.length} problem(s):`);
for (const e of errors) console.error(`  - ${e}`);
process.exit(1);
