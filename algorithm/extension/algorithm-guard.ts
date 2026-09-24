/**
 * Algorithm v4.0 guard — deterministic checks the Algorithm prompt cannot enforce.
 *
 * The method itself lives in `skill://algorithm`; this module only enforces the
 * invariants a model is known to break on its own:
 *
 *   - a PRD cannot claim `complete` while criteria are unchecked or lack
 *     evidence in `## Verification` (v3.7 runs closed at 3/18 and 5/21);
 *   - `progress` must match the checkboxes;
 *   - advanced/deep runs cannot self-attest completion (`verified_by`);
 *   - non-complete terminal phases must explain themselves in `## Outcome`;
 *   - the Advisor role stays review-only and never enters Algorithm.
 *
 * Only PRDs whose frontmatter carries `algorithm: "4.0"` are checked, so legacy
 * v3.7 PRDs (still written by Claude Code) are never blocked.
 *
 * Self-contained on purpose: no imports from other working trees.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const HOME = process.env.HOME || homedir();
export const WORK_ROOT = join(HOME, ".claude", "MEMORY", "WORK");
const SKILL_PATH = join(HOME, ".omp", "agent", "skills", "algorithm", "SKILL.md");

const TERMINAL: Record<string, true> = { complete: true, partial: true, blocked: true, abandoned: true };
const PHASES: Record<string, true> = { observe: true, plan: true, execute: true, verify: true, ...TERMINAL };
const EFFORTS: Record<string, true> = { standard: true, advanced: true, deep: true };
const ATTESTED_EFFORTS: Record<string, true> = { advanced: true, deep: true };
const REQUIRED_FIELDS = ["task", "slug", "effort", "phase", "progress", "started", "updated"];
const SELF_ATTESTATION = /^(self|author|me|main|primary|agent)$/i;
const STALE_MS = 24 * 60 * 60 * 1000;

const ADVISOR_TOOLS: Record<string, true> = { read: true, grep: true, glob: true, advise: true };

// --- PRD parsing ---------------------------------------------------------------

export function parseFrontmatter(text: string): Record<string, string> | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!match) return null;
	const fields: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (!kv) continue;
		fields[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
	}
	return fields;
}

/** Body of a `## <title>` section up to the next level-2 heading, or null. */
function section(text: string, title: string): string | null {
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim() === `## ${title}`);
	if (start === -1) return null;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^##\s/.test(line));
	return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** Violations of the Algorithm v4.0 PRD contract; empty when valid or not a v4.0 PRD. */
export function validatePrd(text: string): string[] {
	const fm = parseFrontmatter(text);
	if (fm?.algorithm !== "4.0") return [];
	const errors: string[] = [];

	for (const field of REQUIRED_FIELDS) {
		if (!fm[field]) errors.push(`frontmatter: нет поля \`${field}\``);
	}
	const phase = fm.phase ?? "";
	const effort = fm.effort ?? "";
	if (phase && PHASES[phase] !== true) errors.push(`frontmatter: неизвестная phase \`${phase}\``);
	if (effort && EFFORTS[effort] !== true) errors.push(`frontmatter: неизвестный effort \`${effort}\``);

	const criteria = [...text.matchAll(/^\s*-\s*\[([ xX])\]\s*(ISC-A?\d+)\b/gm)];
	const total = criteria.length;
	const checkedIds = criteria.filter((c) => c[1] !== " ").map((c) => c[2]);
	const checked = checkedIds.length;

	const progress = /^(\d+)\/(\d+)$/.exec(fm.progress ?? "");
	if (fm.progress && !progress) {
		errors.push(`frontmatter: progress \`${fm.progress}\` не в формате N/M`);
	} else if (progress && (Number(progress[1]) !== checked || Number(progress[2]) !== total)) {
		errors.push(`progress \`${fm.progress}\` не совпадает с критериями: отмечено ${checked} из ${total}`);
	}

	if (phase === "complete") {
		if (total === 0) errors.push("complete без единого критерия");
		if (checked !== total) errors.push(`complete при ${checked}/${total}: закрой критерии или выбери partial/blocked/abandoned`);
		const verification = section(text, "Verification") ?? "";
		const evidenced = new Set(verification.match(/\bISC-A?\d+\b/g) ?? []);
		const missing = checkedIds.filter((id) => !evidenced.has(id));
		if (missing.length > 0) errors.push(`нет доказательства в ## Verification для: ${missing.join(", ")}`);
		if (ATTESTED_EFFORTS[effort] === true) {
			const verifiedBy = fm.verified_by ?? "";
			if (!verifiedBy || SELF_ATTESTATION.test(verifiedBy)) {
				errors.push(`effort ${effort}: complete требует verified_by от проверяющего (reviewer:<id> | loop_validate | user)`);
			}
		}
	}

	if (phase === "partial" || phase === "blocked" || phase === "abandoned") {
		if (!(section(text, "Outcome") ?? "").trim()) errors.push(`phase ${phase} требует непустой раздел ## Outcome`);
	}

	return errors;
}

// --- Path helpers ----------------------------------------------------------------

function expandPath(path: string, cwd: string): string {
	if (path.startsWith("~/")) return join(HOME, path.slice(2));
	return isAbsolute(path) ? path : resolve(cwd, path);
}

export function isRunPrdPath(path: string, cwd: string): boolean {
	if (path.includes("://")) return false;
	const absolute = expandPath(path, cwd);
	const prefix = `${WORK_ROOT}/`;
	if (!absolute.startsWith(prefix) || !absolute.endsWith("/PRD.md")) return false;
	return absolute.slice(prefix.length).split("/").length === 2;
}

/** File paths named by hashline `[PATH#TAG]` section headers in an `edit` payload. */
export function editedPaths(patch: unknown): string[] {
	if (typeof patch !== "string") return [];
	return [...patch.matchAll(/^\[(.+?)#[0-9A-Fa-f]{4}\]\s*$/gm)].map((m) => m[1]);
}

// --- Doctor ------------------------------------------------------------------------

const RUN_DIR = /^\d{8}-/;
const WORK_ALLOWED_FILES: Record<string, true> = { "README.md": true, ".gitkeep": true };

export type DoctorReport = {
	skillPresent: boolean;
	foreign: string[];
	invalid: string[];
	stale: string[];
	legacyOpen: number;
};

export function runDoctor(workRoot = WORK_ROOT, now = Date.now()): DoctorReport {
	const report: DoctorReport = { skillPresent: existsSync(SKILL_PATH), foreign: [], invalid: [], stale: [], legacyOpen: 0 };
	if (!existsSync(workRoot)) return report;
	for (const name of readdirSync(workRoot).sort()) {
		const path = join(workRoot, name);
		if (!statSync(path).isDirectory()) {
			if (WORK_ALLOWED_FILES[name] !== true) report.foreign.push(name);
			continue;
		}
		if (!RUN_DIR.test(name)) {
			report.foreign.push(`${name}/`);
			continue;
		}
		const prdPath = join(path, "PRD.md");
		if (!existsSync(prdPath)) continue;
		const text = readFileSync(prdPath, "utf8");
		const fm = parseFrontmatter(text) ?? {};
		const terminal = TERMINAL[fm.phase ?? ""] === true;
		if (fm.algorithm !== "4.0") {
			if (!terminal) report.legacyOpen += 1;
			continue;
		}
		if (validatePrd(text).length > 0) report.invalid.push(name);
		if (!terminal && now - statSync(prdPath).mtimeMs > STALE_MS) report.stale.push(name);
	}
	return report;
}

export function formatDoctor(report: DoctorReport): { message: string; level: "info" | "warning" | "error" } {
	const parts = [
		`skill: ${report.skillPresent ? "ok" : "НЕТ"}`,
		`невалидные v4.0: ${report.invalid.length}`,
		`зависшие v4.0 (>24ч): ${report.stale.length}`,
		`посторонние в WORK: ${report.foreign.length}`,
		`незакрытые legacy: ${report.legacyOpen}`,
	];
	const details = [
		report.invalid.length ? `невалидные: ${report.invalid.join(", ")}` : "",
		report.stale.length ? `зависшие: ${report.stale.join(", ")}` : "",
		report.foreign.length ? `посторонние: ${report.foreign.join(", ")}` : "",
	].filter(Boolean);
	const level = !report.skillPresent || report.invalid.length > 0
		? "error"
		: report.stale.length > 0 || report.foreign.length > 0
			? "warning"
			: "info";
	return { message: [`Algorithm doctor — ${parts.join("; ")}`, ...details].join("\n"), level };
}

// --- Extension ---------------------------------------------------------------------

const GUARD_PREFIX = "algorithm-guard: PRD нарушает контракт Algorithm v4.0 (skill://algorithm):\n- ";

export default function algorithmGuard(pi: ExtensionAPI): void {
	let isAdvisorTurn = false;

	pi.on("before_agent_start", (event) => {
		isAdvisorTurn = event.prompt.trimStart().startsWith("### Session update") && event.prompt.includes("**agent**:");
	});

	pi.on("tool_call", (event, ctx) => {
		const input = event.input as Record<string, unknown> | undefined;
		const path = typeof input?.path === "string" ? input.path : "";
		if (isAdvisorTurn) {
			if (ADVISOR_TOOLS[event.toolName] !== true) {
				return { block: true, reason: "algorithm-guard: Advisor только ревьюит — доступны read, grep, glob, advise." };
			}
			if (path.startsWith("skill://algorithm") || path.endsWith("/skills/algorithm/SKILL.md")) {
				return { block: true, reason: "algorithm-guard: Advisor не входит в Algorithm." };
			}
			return;
		}
		if (event.toolName !== "write") return;
		const content = typeof input?.content === "string" ? input.content : "";
		if (!path || !isRunPrdPath(path, ctx?.cwd ?? process.cwd())) return;
		const errors = validatePrd(content);
		if (errors.length > 0) return { block: true, reason: GUARD_PREFIX + errors.join("\n- ") };
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== "edit" || event.isError) return;
		const cwd = ctx?.cwd ?? process.cwd();
		const errors = editedPaths(event.input?.input)
			.filter((path) => isRunPrdPath(path, cwd))
			.flatMap((path) => {
				const absolute = expandPath(path, cwd);
				return existsSync(absolute) ? validatePrd(readFileSync(absolute, "utf8")) : [];
			});
		if (errors.length === 0) return;
		return {
			content: [...event.content, { type: "text", text: `\n${GUARD_PREFIX}${errors.join("\n- ")}\nПравка применена; исправь PRD следующей правкой.` }],
			isError: true,
		};
	});

	pi.registerCommand("algorithm-doctor", {
		description: "Проверить Algorithm v4.0: skill, незакрытые и невалидные PRD, мусор в MEMORY/WORK",
		handler: async (_args, context) => {
			const { message, level } = formatDoctor(runDoctor());
			context.ui.notify(message, level);
		},
	});
}
