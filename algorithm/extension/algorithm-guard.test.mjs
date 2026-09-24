// Запуск: bun ~/.omp/agent/skills/algorithm/extension/algorithm-guard.test.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "algorithm-guard-"));
process.env.HOME = home;
const guard = await import("./algorithm-guard.ts");
const { validatePrd, runDoctor, formatDoctor, WORK_ROOT } = guard;
assert.equal(WORK_ROOT, join(home, ".claude", "MEMORY", "WORK"));

// criteria: [status, id, text?]; status — true (x), false (пробел) или "DEFERRED-VERIFY".
const prd = ({ fm = {}, criteria = [], verification = "", outcome = "", askCheck = "- ✓ «Тестовая задача» → сделано" } = {}) => {
	const live = criteria.filter(([, , text]) => !text?.startsWith("[DROPPED"));
	const front = {
		algorithm: '"4.1-omp"',
		task: "Тестовая задача",
		stated_goal: '"сделай тестовую задачу"',
		slug: "20260924-120000_test",
		effort: "standard",
		phase: "execute",
		progress: `${live.filter(([status]) => status === true).length}/${live.length}`,
		started: "2026-09-24T12:00:00Z",
		updated: "2026-09-24T12:00:00Z",
		...fm,
	};
	const lines = ["---", ...Object.entries(front).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`), "---", "", "## Criteria"];
	for (const [status, id, text = "критерий"] of criteria) {
		const mark = status === true ? "x" : status === false ? " " : status;
		lines.push(`- [${mark}] ${id}: ${text}`);
	}
	if (verification) lines.push("", "## Verification", verification);
	if (askCheck) lines.push("", "## Ask Check", askCheck);
	if (outcome) lines.push("", "## Outcome", outcome);
	return `${lines.join("\n")}\n`;
};
const complete = (extra = {}) => prd({ ...extra, fm: { phase: "complete", ...extra.fm } });

try {
	// Legacy v3.7 PRD никогда не блокируется.
	assert.deepEqual(validatePrd("---\ntask: x\nphase: complete\nprogress: 3/18\n---\n- [ ] ISC-1: a\n"), []);

	// Цель пользователя обязательна дословно.
	assert.ok(validatePrd(prd({ fm: { stated_goal: undefined } })).some((e) => e.includes("stated_goal")));

	// complete при частичных критериях — ошибка (дефект v3.7: 3/18, 5/21).
	const partialComplete = validatePrd(complete({ criteria: [[true, "ISC-1"], [false, "ISC-2"]], verification: "ISC-1: ok" }));
	assert.ok(partialComplete.some((e) => e.includes("complete при 1/2")), partialComplete.join("|"));

	// progress должен совпадать с чекбоксами.
	const drift = validatePrd(prd({ fm: { progress: "2/2" }, criteria: [[true, "ISC-1"], [false, "ISC-2"]] }));
	assert.ok(drift.some((e) => e.includes("не совпадает")), drift.join("|"));

	// Каждый отмеченный критерий требует доказательства; ISC-1 не засчитывается упоминанием ISC-10.
	assert.deepEqual(
		validatePrd(complete({ criteria: [[true, "ISC-1"], [true, "ISC-10"]], verification: "ISC-10: `bun test` → 12 pass" })),
		["нет доказательства в ## Verification для: ISC-1"],
	);
	// Дочерний ISC-3.1 — отдельный ID: его доказательство не закрывает ISC-3, а точка в конце фразы не ломает ID.
	assert.deepEqual(
		validatePrd(complete({ criteria: [[true, "ISC-3"], [true, "ISC-3.1"]], verification: "Проверено ISC-3.1: read → ok" })),
		["нет доказательства в ## Verification для: ISC-3"],
	);
	assert.deepEqual(validatePrd(complete({ criteria: [[true, "ISC-3"]], verification: "curl -i → 200, закрывает ISC-3." })), []);

	// Валидный standard complete проходит без verified_by.
	const valid = complete({ criteria: [[true, "ISC-1"], [true, "ISC-A1"]], verification: "ISC-1: файл есть\nISC-A1: прод не тронут" });
	assert.deepEqual(validatePrd(valid), []);

	// Ask Check: обязателен для complete, ✗ блокирует, строка без статуса — ошибка, SKIP с причиной допустим.
	const base = { criteria: [[true, "ISC-1"]], verification: "ISC-1: ok" };
	assert.ok(validatePrd(complete({ ...base, askCheck: "" })).some((e) => e.includes("требует ## Ask Check")));
	assert.ok(validatePrd(complete({ ...base, askCheck: "- ✓ «a» → да\n- ✗ «b» — не сделано" })).some((e) => e.includes("(✗): 1")));
	assert.ok(validatePrd(complete({ ...base, askCheck: "- «a» сделано" })).some((e) => e.includes("без статуса")));
	assert.deepEqual(validatePrd(complete({ ...base, askCheck: "- ✓ «a» → да\n- SKIP «b» — вне границ, согласовано" })), []);

	// ID не перенумеровывают: дубль — ошибка; tombstone остаётся в тексте, но выпадает из счёта.
	assert.ok(validatePrd(prd({ criteria: [[false, "ISC-2"], [false, "ISC-2"]] })).some((e) => e.includes("повторяются: ISC-2")));
	assert.deepEqual(validatePrd(complete({
		criteria: [[true, "ISC-1"], [false, "ISC-2", "[DROPPED — см. Decisions]"]],
		verification: "ISC-1: ok",
	})), []);

	// DEFERRED-VERIFY: допустим в complete только с follow-up; в progress не засчитывается.
	const deferred = (verification) => complete({ fm: { progress: "1/2" }, criteria: [[true, "ISC-1"], ["DEFERRED-VERIFY", "ISC-2"]], verification });
	assert.ok(validatePrd(deferred("ISC-1: ok\nISC-2: деплой недоступен")).some((e) => e.includes("follow-up")));
	assert.deepEqual(validatePrd(deferred("ISC-1: ok\nISC-2: деплой недоступен, follow-up: OMP-42")), []);

	// advanced complete: самоаттестация запрещена, проверяющий принимается.
	const advanced = (verified_by) => complete({ fm: { effort: "advanced", verified_by }, ...base });
	assert.ok(validatePrd(advanced(undefined)).some((e) => e.includes("verified_by")));
	assert.ok(validatePrd(advanced("self")).some((e) => e.includes("verified_by")));
	assert.deepEqual(validatePrd(advanced("reviewer:PrdReviewer")), []);

	// partial/blocked/abandoned требуют Outcome.
	assert.ok(validatePrd(prd({ fm: { phase: "blocked" }, criteria: [[false, "ISC-1"]] })).some((e) => e.includes("## Outcome")));
	assert.deepEqual(validatePrd(prd({ fm: { phase: "blocked" }, criteria: [[false, "ISC-1"]], outcome: "Нужен доступ к PROD." })), []);

	// --- Хуки extension ---
	const handlers = {};
	const commands = {};
	guard.default({
		on: (name, handler) => { handlers[name] = handler; },
		registerCommand: (name, command) => { commands[name] = command; },
	});
	const ctx = { cwd: home };
	await handlers.before_agent_start({ prompt: "Сделай миграцию", systemPrompt: [] });

	const runDir = join(WORK_ROOT, "20260924-120000_test");
	mkdirSync(runDir, { recursive: true });
	const prdPath = join(runDir, "PRD.md");
	const bad = prd({ fm: { phase: "complete" }, criteria: [[true, "ISC-1"], [false, "ISC-2"]], verification: "ISC-1: ok" });

	// write невалидного PRD блокируется, в том числе по пути через ~.
	const blocked = await handlers.tool_call({ toolName: "write", toolCallId: "w1", input: { path: prdPath, content: bad } }, ctx);
	assert.equal(blocked?.block, true);
	const blockedTilde = await handlers.tool_call({ toolName: "write", toolCallId: "w2", input: { path: "~/.claude/MEMORY/WORK/20260924-120000_test/PRD.md", content: bad } }, ctx);
	assert.equal(blockedTilde?.block, true);
	// Валидный PRD и посторонние файлы проходят.
	assert.equal(await handlers.tool_call({ toolName: "write", toolCallId: "w3", input: { path: prdPath, content: valid } }, ctx), undefined);
	assert.equal(await handlers.tool_call({ toolName: "write", toolCallId: "w4", input: { path: join(runDir, "notes.md"), content: bad } }, ctx), undefined);

	// edit, оставивший PRD невалидным, превращается в ошибку с объяснением.
	writeFileSync(prdPath, bad);
	const edited = await handlers.tool_result({
		toolName: "edit",
		toolCallId: "e1",
		isError: false,
		input: { input: `[${prdPath}#A1B2]\nPUT 3.=3:\n+phase: complete\n` },
		content: [{ type: "text", text: "ok" }],
	}, ctx);
	assert.equal(edited?.isError, true);
	assert.match(edited.content.at(-1).text, /complete при 1\/2/);
	writeFileSync(prdPath, valid);
	assert.equal(await handlers.tool_result({
		toolName: "edit", toolCallId: "e2", isError: false,
		input: { input: `[${prdPath}#A1B2]\nPUT 3.=3:\n+phase: complete\n` },
		content: [{ type: "text", text: "ok" }],
	}, ctx), undefined);

	// Advisor: только ревью-инструменты и без входа в Algorithm.
	await handlers.before_agent_start({ prompt: "### Session update\n\n**agent**:\nработаю", systemPrompt: [] });
	assert.equal((await handlers.tool_call({ toolName: "bash", toolCallId: "a1", input: { command: "ls" } }, ctx))?.block, true);
	assert.equal((await handlers.tool_call({ toolName: "read", toolCallId: "a2", input: { path: "skill://algorithm" } }, ctx))?.block, true);
	assert.equal(await handlers.tool_call({ toolName: "read", toolCallId: "a3", input: { path: prdPath } }, ctx), undefined);
	await handlers.before_agent_start({ prompt: "обычный ход", systemPrompt: [] });
	assert.equal(await handlers.tool_call({ toolName: "bash", toolCallId: "a4", input: { command: "ls" } }, ctx), undefined);

	// --- Doctor ---
	writeFileSync(join(WORK_ROOT, "n8n-backup.json"), "{}");
	mkdirSync(join(WORK_ROOT, "env-dump"));
	const legacyDir = join(WORK_ROOT, "20260801-000000_legacy");
	mkdirSync(legacyDir);
	writeFileSync(join(legacyDir, "PRD.md"), "---\nphase: execute\nprogress: 0/3\n---\n");
	const staleDir = join(WORK_ROOT, "20260901-000000_stale");
	mkdirSync(staleDir);
	writeFileSync(join(staleDir, "PRD.md"), prd({ criteria: [[false, "ISC-1"]] }));
	const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
	utimesSync(join(staleDir, "PRD.md"), old, old);
	writeFileSync(prdPath, bad);

	const report = runDoctor();
	assert.deepEqual(report.foreign, ["env-dump/", "n8n-backup.json"]);
	assert.deepEqual(report.invalid, ["20260924-120000_test"]);
	assert.deepEqual(report.stale, ["20260901-000000_stale"]);
	assert.equal(report.legacyOpen, 1);
	assert.equal(report.skillPresent, false);
	assert.equal(formatDoctor(report).level, "error");

	let notified;
	await commands["algorithm-doctor"].handler("", { ui: { notify: (message, level) => { notified = { message, level }; } } });
	assert.match(notified.message, /посторонние: env-dump\/, n8n-backup\.json/);
	assert.ok(readFileSync(prdPath, "utf8").includes("phase: complete"));

	console.log("algorithm-guard: all checks passed");
} finally {
	rmSync(home, { recursive: true, force: true });
}
