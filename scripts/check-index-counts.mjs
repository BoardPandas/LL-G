#!/usr/bin/env node
/**
 * LL-G index reconciler: keeps the master llms.txt honest about what kb/ contains.
 *
 * The entry counts in the master index are maintained by hand, in a second place,
 * by whoever last added an entry -- so they drift, and every drift is SILENT:
 *
 *   1. A stale count       -> nobody notices; the number is prose, nothing reads it.
 *   2. A tech with NO master line -> that entire folder is invisible to any agent
 *      that loads the master index and stops there. The lessons exist and never
 *      load, which is indistinguishable from their not existing.
 *   3. A master line for a kb/ folder that was deleted or renamed -> a dangling
 *      fetch that 404s mid-task.
 *
 * Counting is the fiddly part, because index bullet format is NOT uniform:
 *   - most:                    "- [Title](slug.md): ... SEV."
 *   - ninjaone, teams-sharepoint: "- HIGH [Title](slug.md): ..." plus a
 *                                 "## Entries (N)" header that ALSO drifts.
 * A regex matching only the first shape silently returns 0 for a file with 7
 * entries, and that zero then propagates into the master as an authoritative-
 * looking number. So: match both shapes, and treat a zero as an error rather
 * than a count.
 *
 * Usage, from the root of an LL-G checkout:
 *   node scripts/check-index-counts.mjs          # report drift, exit 1 if any
 *   node scripts/check-index-counts.mjs --fix    # rewrite counts in place
 *
 * --fix rewrites only NUMBERS and, for a tech with no master line at all, appends
 * a section derived from that index's own H1 and blurb. It never rewrites an
 * existing curated description -- those are hand-written topic summaries and are
 * not the script's to reword.
 *
 * Deliberately operates on a local checkout, not the contents API: edits land as
 * a normal commit you review, instead of a series of blind PUTs that can clobber
 * a concurrent writer (see kb/git/github-contents-sha-refresh-defeats-cas.md).
 *
 * Node built-ins only, no dependencies. Exit 0 = clean, 1 = drift found.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MASTER = "llms.txt";
const KB = "kb";
const FIX = process.argv.includes("--fix");

const errors = [];
const fixes = [];

const exists = (p) => {
	try {
		statSync(p);
		return true;
	} catch {
		return false;
	}
};

if (!exists(MASTER) || !exists(KB)) {
	console.error("index-counts: run this from the root of an LL-G checkout (needs ./llms.txt and ./kb/).");
	process.exit(1);
}

// Both bullet shapes. The optional severity prefix is what ninjaone and
// teams-sharepoint use; everything else omits it.
const BULLET = /^- (?:(?:HIGH|MEDIUM|LOW)\s+)?\[/gm;
// Self-header some indexes carry: "## Entries (7)".
const SELF_HEADER = /^## Entries \((\d+)\)/m;

const plural = (n) => `(${n} ${n === 1 ? "entry" : "entries"})`;

/** Count entries in one kb/<tech>/llms.txt. Returns null when the file is unreadable. */
function countEntries(text) {
	return (text.match(BULLET) || []).length;
}

// ---- gather kb/ state -------------------------------------------------------

const techs = readdirSync(KB, { withFileTypes: true })
	.filter((d) => d.isDirectory() && exists(join(KB, d.name, "llms.txt")))
	.map((d) => d.name)
	.sort();

const actual = new Map();
for (const tech of techs) {
	const path = join(KB, tech, "llms.txt");
	const text = readFileSync(path, "utf8");
	const n = countEntries(text);
	if (n === 0) {
		// Never write a zero into the master -- a zero here means the bullet format
		// changed, not that the folder is empty.
		errors.push(`${path}: 0 entries matched. Either the file is empty or its bullet format is new; teach this script the shape rather than recording a zero.`);
		continue;
	}
	actual.set(tech, { n, path, text });
}

// ---- master index -----------------------------------------------------------

let master = readFileSync(MASTER, "utf8");

// One line per tech: "- [X index](kb/<tech>/llms.txt): <desc> (N entries)"
const MASTER_LINE = /^- \[[^\]]+\]\(kb\/([a-z0-9.-]+)\/llms\.txt\)(.*)$/gm;
const claimed = new Map();
for (const m of master.matchAll(MASTER_LINE)) {
	const count = m[2].match(/\((\d+) entr(?:y|ies)\)\s*$/);
	claimed.set(m[1], { count: count ? Number(count[1]) : null, line: m[0] });
}

// 1. master line present but count wrong or absent
for (const [tech, { n }] of actual) {
	const c = claimed.get(tech);
	if (!c) continue; // handled below
	if (c.count === n) continue;
	if (c.count === null) {
		errors.push(`${MASTER}: kb/${tech} line has no "(N entries)" suffix (actual: ${n}).`);
		if (FIX) {
			master = master.replace(c.line, `${c.line.replace(/\s*$/, "")} ${plural(n)}`);
			fixes.push(`${MASTER}: kb/${tech} -> added ${plural(n)}`);
		}
		continue;
	}
	errors.push(`${MASTER}: kb/${tech} claims ${c.count} entries, folder has ${n}.`);
	if (FIX) {
		master = master.replace(c.line, c.line.replace(/\((\d+) entr(?:y|ies)\)(\s*)$/, `${plural(n)}$2`));
		fixes.push(`${MASTER}: kb/${tech} ${c.count} -> ${n}`);
	}
}

// 2. tech folder with no master line at all -- the invisible-folder case
for (const [tech, { n, text }] of actual) {
	if (claimed.has(tech)) continue;
	errors.push(`${MASTER}: no line for kb/${tech} ${plural(n)}. That folder is invisible to anything that loads only the master index.`);
	if (!FIX) continue;
	// Derive the section from the index's own content -- never invent prose.
	const h1 = text.match(/^#\s+(.+?)(?:\s+Gotchas)?\s*$/m);
	const blurb = text.match(/^>\s*(.+?)\s*$/m);
	const name = h1 ? h1[1] : tech;
	const desc = blurb ? blurb[1].replace(/\.$/, "") : `All ${name} gotchas`;
	const section = `\n### ${name}\n- [${name} index](kb/${tech}/llms.txt): ${desc} ${plural(n)}\n`;
	master = master.replace(/\s*$/, `\n${section}`);
	fixes.push(`${MASTER}: appended section for kb/${tech} (derived from its H1 + blurb -- replace with a real topic summary)`);
}

// 3. master line pointing at a kb/ folder that is gone
for (const [tech] of claimed) {
	if (actual.has(tech)) continue;
	errors.push(`${MASTER}: line for kb/${tech}/llms.txt, but that folder has no llms.txt. Dangling reference -- a fetch of it 404s mid-task.`);
}

// ---- per-index "## Entries (N)" self-headers --------------------------------

for (const [tech, { n, path, text }] of actual) {
	const h = text.match(SELF_HEADER);
	if (!h) continue;
	if (Number(h[1]) === n) continue;
	errors.push(`${path}: "## Entries (${h[1]})" header disagrees with its own ${n} bullets.`);
	if (FIX) {
		writeFileSync(path, text.replace(SELF_HEADER, `## Entries (${n})`), "utf8");
		fixes.push(`${path}: header ${h[1]} -> ${n}`);
	}
}

// ---- report -----------------------------------------------------------------

if (FIX && fixes.length) writeFileSync(MASTER, master, "utf8");

console.log(`index-counts: ${techs.length} tech folders, ${[...actual.values()].reduce((a, b) => a + b.n, 0)} entries total`);

if (!errors.length) {
	console.log("index-counts OK: master index agrees with kb/.");
	process.exit(0);
}

if (FIX) {
	for (const f of fixes) console.log(`  fixed  ${f}`);
	const unfixed = errors.length - fixes.length;
	console.log(`\nindex-counts: applied ${fixes.length} fix(es). Review the diff before committing.`);
	if (unfixed > 0) {
		console.error(`\nindex-counts: ${unfixed} issue(s) need a human:`);
		process.exit(1);
	}
	process.exit(0);
}

console.error(`\nindex-counts FAILED: ${errors.length} issue(s):`);
for (const e of errors) console.error(`  - ${e}`);
console.error("\nRe-run with --fix to reconcile the counts.");
process.exit(1);
