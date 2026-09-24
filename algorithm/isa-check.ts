#!/usr/bin/env bun
/**
 * isa-check — runs the probes of a project ISA (`<project>/ISA.md`) and reports
 * which claims hold. No LLM involved: every claim carries a shell probe and an
 * expectation, and this script only executes and compares.
 *
 *   bun isa-check.ts [ISA.md] [--env test|prod|all] [--only ISC-1,ISC-2|Раздел]
 *                    [--baseline <report.json>] [--jobs N] [--json] [--verbose]
 *
 * The ISA file is never modified. Each run writes `.isa/runs/<stamp>.json` next
 * to ISA.md and `.isa/last.json`; `.isa/` ignores itself, so project git stays clean.
 *
 * Exit codes: 0 — no failures; 1 — a probe failed or regressed; 2 — format or usage error.
 * Format reference: `ISA-FORMAT.md` next to this file.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ClaimStatus = "open" | "done" | "deferred";
export type Expect = { kind: "exit0" } | { kind: "fail"; pattern: RegExp | null } | { kind: "stdout"; pattern: RegExp };

export type Claim = {
	id: string;
	status: ClaimStatus;
	text: string;
	section: string;
	line: number;
	probe: string;
	expect: Expect | null;
	expectRaw: string;
	env: string;
	timeoutSec: number;
	dropped: boolean;
};

export type Outcome = "pass" | "fail" | "manual" | "skipped";

export type ClaimResult = {
	id: string;
	text: string;
	section: string;
	marked: ClaimStatus;
	outcome: Outcome;
	exitCode: number | null;
	timedOut: boolean;
	durationMs: number;
	detail: string;
};

export type Report = {
	isa: string;
	project: string;
	startedAt: string;
	env: string;
	/** `--only` filter of this run; empty means the whole ISA. */
	only: string[];
	/** Absolute path of the baseline report, or null. */
	baseline: string | null;
	summary: Record<Outcome, number>;
	/** Passed in baseline, failed now. */
	regressions: string[];
	/** Passed in baseline, not executed now (filtered out, skipped by env, manual, removed). */
	notRechecked: string[];
	drift: string[];
	results: ClaimResult[];
};

const DEFAULT_TIMEOUT_SEC = 60;
const DETAIL_CHARS = 600;
const CRITERION = /^\s*-\s*\[( |x|X|DEFERRED-VERIFY)\]\s*(ISC-A?\d+(?:\.\d+)*)(?!\w|\.\d)\s*:?\s*(.*)$/;
const FIELD = /^\s+(probe|expect|env|timeout):\s*(.*)$/;

function parseRegex(raw: string): RegExp | null {
	const m = /^\/(.*)\/([a-z]*)$/.exec(raw.trim());
	return m ? new RegExp(m[1], m[2]) : null;
}

function parseExpect(raw: string): Expect | null {
	const value = raw.trim();
	if (value === "exit 0") return { kind: "exit0" };
	if (value === "fail") return { kind: "fail", pattern: null };
	if (value.startsWith("fail ")) {
		const pattern = parseRegex(value.slice(5));
		return pattern ? { kind: "fail", pattern } : null;
	}
	if (value.startsWith("stdout ")) {
		const pattern = parseRegex(value.slice(7));
		return pattern ? { kind: "stdout", pattern } : null;
	}
	return null;
}

/** Claims and format errors of an ISA document. */
export function parseIsa(text: string): { project: string; claims: Claim[]; errors: string[] } {
	const project = /^project:\s*"?([^"\n]+)"?\s*$/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "")?.[1]?.trim() ?? "";
	const lines = text.split(/\r?\n/);
	const claims: Claim[] = [];
	const errors: string[] = [];
	let section = "";
	let current: Claim | null = null;

	lines.forEach((line, index) => {
		const heading = /^##\s+(.+?)\s*$/.exec(line);
		if (heading) {
			section = heading[1];
			current = null;
			return;
		}
		const criterion = CRITERION.exec(line);
		if (criterion) {
			const mark = criterion[1];
			current = {
				id: criterion[2],
				status: mark === "DEFERRED-VERIFY" ? "deferred" : mark === " " ? "open" : "done",
				text: criterion[3],
				section,
				line: index + 1,
				probe: "",
				expect: null,
				expectRaw: "",
				env: "test",
				timeoutSec: DEFAULT_TIMEOUT_SEC,
				dropped: criterion[3].startsWith("[DROPPED"),
			};
			claims.push(current);
			return;
		}
		const field = current ? FIELD.exec(line) : null;
		if (!current || !field) {
			if (line.trim() && !/^\s/.test(line)) current = null;
			return;
		}
		const value = field[2].trim();
		if (field[1] === "probe") current.probe = value.replace(/^`(.*)`$/, "$1");
		if (field[1] === "expect") current.expectRaw = value;
		if (field[1] === "env") current.env = value;
		if (field[1] === "timeout") current.timeoutSec = Number(value);
	});

	const seen = new Set<string>();
	for (const claim of claims) {
		const where = `${claim.id} (строка ${claim.line})`;
		if (seen.has(claim.id)) errors.push(`${where}: ID повторяется`);
		seen.add(claim.id);
		if (claim.dropped) continue;
		if (!claim.probe) {
			errors.push(`${where}: нет probe`);
			continue;
		}
		if (claim.env !== "test" && claim.env !== "prod") errors.push(`${where}: env должен быть test или prod`);
		if (!Number.isFinite(claim.timeoutSec) || claim.timeoutSec <= 0) errors.push(`${where}: timeout — положительное число секунд`);
		if (claim.probe === "manual") continue;
		claim.expect = parseExpect(claim.expectRaw || "exit 0");
		if (!claim.expect) errors.push(`${where}: expect «${claim.expectRaw}» — ожидается exit 0 | fail | fail /re/ | stdout /re/`);
	}
	return { project, claims, errors };
}

/** KEY=VALUE pairs from a dotenv file; quotes stripped, comments and `export` ignored. */
export function readDotenv(path: string): Record<string, string> {
	if (!existsSync(path)) return {};
	const vars: Record<string, string> = {};
	for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
		const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (!m) continue;
		vars[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
	}
	return vars;
}

type ProbeRun = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number };

/** Runs a probe in its own process group so a timeout kills the whole tree. */
function runProbe(command: string, cwd: string, env: Record<string, string>, timeoutSec: number): Promise<ProbeRun> {
	const started = Date.now();
	const { promise, resolve: done } = Promise.withResolvers<ProbeRun>();
	const child = spawn("bash", ["-c", command], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	const timer = setTimeout(() => {
		timedOut = true;
		try { process.kill(-(child.pid ?? 0), "SIGKILL"); } catch { child.kill("SIGKILL"); }
	}, timeoutSec * 1000);
	child.on("error", (error) => {
		clearTimeout(timer);
		done({ exitCode: null, stdout, stderr: `${stderr}${error.message}`, timedOut, durationMs: Date.now() - started });
	});
	child.on("close", (code) => {
		clearTimeout(timer);
		done({ exitCode: timedOut ? null : code, stdout, stderr, timedOut, durationMs: Date.now() - started });
	});
	return promise;
}

function judge(expect: Expect, run: ProbeRun): { pass: boolean; why: string } {
	if (run.timedOut) return { pass: false, why: "таймаут" };
	if (expect.kind === "exit0") return { pass: run.exitCode === 0, why: `exit ${run.exitCode}` };
	if (expect.kind === "fail") {
		if (run.exitCode === 0) return { pass: false, why: "exit 0, ожидался провал команды" };
		if (!expect.pattern) return { pass: true, why: `exit ${run.exitCode}` };
		const matched = expect.pattern.test(`${run.stdout}\n${run.stderr}`);
		return { pass: matched, why: matched ? `exit ${run.exitCode}` : `exit ${run.exitCode}, вывод не совпал с ${expect.pattern}` };
	}
	// Trailing newlines are output noise: `/^200$/` must match `echo 200`.
	const matched = run.exitCode === 0 && expect.pattern.test(run.stdout.replace(/\s+$/, ""));
	return { pass: matched, why: run.exitCode !== 0 ? `exit ${run.exitCode}` : matched ? "stdout совпал" : `stdout не совпал с ${expect.pattern}` };
}

export type CheckOptions = {
	env?: "test" | "prod" | "all";
	only?: string[];
	baseline?: string | null;
	jobs?: number;
	now?: Date;
};

export async function checkIsa(isaPath: string, options: CheckOptions = {}): Promise<{ report: Report; errors: string[]; reportPath: string | null }> {
	const isa = resolve(isaPath);
	const root = dirname(isa);
	const { project, claims, errors } = parseIsa(readFileSync(isa, "utf8"));
	const env = options.env ?? "test";
	const only = options.only ?? [];
	const baseline = options.baseline ? resolve(options.baseline) : null;
	const startedAt = (options.now ?? new Date()).toISOString();
	const empty: Record<Outcome, number> = { pass: 0, fail: 0, manual: 0, skipped: 0 };
	const report: Report = {
		isa, project, startedAt, env, only, baseline, summary: { ...empty }, regressions: [], notRechecked: [], drift: [], results: [],
	};
	const unknown = only.filter((name) => !claims.some((c) => c.id === name || c.section === name));
	if (unknown.length > 0) errors.push(`--only: нет утверждений или разделов ${unknown.map((n) => `«${n}»`).join(", ")}`);
	if (baseline && !existsSync(baseline)) errors.push(`--baseline: файл не найден: ${baseline}`);
	if (errors.length > 0) return { report, errors, reportPath: null };

	const probeEnv: Record<string, string> = {
		...(process.env as Record<string, string>),
		...readDotenv(join(root, ".env")),
		...readDotenv(join(root, ".env.local")),
	};
	const selected = claims.filter((c) => !c.dropped && (only.length === 0 || only.includes(c.id) || only.includes(c.section)));
	const results: ClaimResult[] = selected.map((c) => ({
		id: c.id, text: c.text, section: c.section, marked: c.status, outcome: "skipped", exitCode: null, timedOut: false, durationMs: 0, detail: "",
	}));

	const queue = selected.map((claim, index) => ({ claim, index }));
	const worker = async () => {
		for (let item = queue.shift(); item; item = queue.shift()) {
			const { claim, index } = item;
			const result = results[index];
			if (claim.probe === "manual") {
				result.outcome = "manual";
				continue;
			}
			if (env !== "all" && claim.env !== env) {
				result.detail = `env ${claim.env}`;
				continue;
			}
			const run = await runProbe(claim.probe, root, probeEnv, claim.timeoutSec);
			const verdict = judge(claim.expect as Expect, run);
			result.outcome = verdict.pass ? "pass" : "fail";
			result.exitCode = run.exitCode;
			result.timedOut = run.timedOut;
			result.durationMs = run.durationMs;
			result.detail = verdict.pass
				? verdict.why
				: `${verdict.why}\n${`${run.stdout}\n${run.stderr}`.trim().slice(-DETAIL_CHARS)}`.trim();
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, options.jobs ?? 4) }, worker));

	report.results = results;
	for (const r of results) report.summary[r.outcome] += 1;
	report.drift = results.filter((r) => r.outcome === "fail" && r.marked === "done").map((r) => r.id);
	if (baseline) {
		// Baseline passes must hold in the final run: a failure is a regression, and a claim
		// the final run did not execute (filtered, skipped, now manual, removed) is unverified.
		const base = JSON.parse(readFileSync(baseline, "utf8")) as Report;
		const outcomeNow = new Map(results.map((r) => [r.id, r.outcome]));
		for (const id of base.results.filter((r) => r.outcome === "pass").map((r) => r.id)) {
			const now = outcomeNow.get(id);
			if (now === "fail") report.regressions.push(id);
			else if (now !== "pass") report.notRechecked.push(id);
		}
	}

	const runsDir = join(root, ".isa", "runs");
	mkdirSync(runsDir, { recursive: true });
	writeFileSync(join(root, ".isa", ".gitignore"), "*\n");
	const reportPath = join(runsDir, `${startedAt.replace(/[:.]/g, "-")}.json`);
	const json = `${JSON.stringify(report, null, 2)}\n`;
	writeFileSync(reportPath, json);
	writeFileSync(join(root, ".isa", "last.json"), json);
	return { report, errors, reportPath };
}

export function formatReport(report: Report, reportPath: string | null, verbose = false): string {
	const s = report.summary;
	const lines = [`ISA ${report.project || report.isa}: ${s.pass} pass · ${s.fail} fail · ${s.manual} manual · ${s.skipped} skipped (env ${report.env})`];
	if (report.baseline) {
		lines.push(report.regressions.length ? `РЕГРЕССИИ относительно baseline: ${report.regressions.join(", ")}` : "Регрессий относительно baseline нет");
		if (report.notRechecked.length) lines.push(`Проходили в baseline, но не перепроверены: ${report.notRechecked.join(", ")}`);
	}
	if (report.drift.length) lines.push(`Отмечены [x], но не проходят: ${report.drift.join(", ")}`);
	for (const r of report.results) {
		if (r.outcome === "fail") lines.push(`✗ ${r.id} [${r.section}] ${r.text}\n    ${r.detail.replace(/\n/g, "\n    ")}`);
		else if (verbose && r.outcome === "pass") lines.push(`✓ ${r.id} ${r.text} (${r.durationMs} мс)`);
	}
	const manual = report.results.filter((r) => r.outcome === "manual").map((r) => r.id);
	if (manual.length) lines.push(`Ручная проверка: ${manual.join(", ")}`);
	if (reportPath) lines.push(`Отчёт: ${reportPath}`);
	return lines.join("\n");
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const flag = (name: string) => {
		const i = args.indexOf(name);
		if (i === -1) return undefined;
		const value = args[i + 1];
		args.splice(i, 2);
		return value;
	};
	const bool = (name: string) => {
		const i = args.indexOf(name);
		if (i !== -1) args.splice(i, 1);
		return i !== -1;
	};
	const env = flag("--env") ?? "test";
	const only = flag("--only");
	const baseline = flag("--baseline") ?? null;
	const jobs = Number(flag("--jobs") ?? 4);
	const asJson = bool("--json");
	const verbose = bool("--verbose");
	const isa = resolve(args[0] ?? "ISA.md");
	if (env !== "test" && env !== "prod" && env !== "all") {
		console.error("--env: test | prod | all");
		process.exit(2);
	}
	if (!existsSync(isa)) {
		console.error(`Нет файла ${isa}`);
		process.exit(2);
	}
	const { report, errors, reportPath } = await checkIsa(isa, {
		env,
		only: only ? only.split(",").map((s) => s.trim()).filter(Boolean) : [],
		baseline,
		jobs,
	});
	if (errors.length > 0) {
		console.error(`Ошибки формата или аргументов ${isa}:\n- ${errors.join("\n- ")}`);
		process.exit(2);
	}
	console.log(asJson ? JSON.stringify(report, null, 2) : formatReport(report, reportPath, verbose));
	process.exit(report.summary.fail > 0 || report.regressions.length > 0 || report.notRechecked.length > 0 ? 1 : 0);
}
