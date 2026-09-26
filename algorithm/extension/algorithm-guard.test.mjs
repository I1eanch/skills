// Запуск: bun ~/.omp/agent/skills/algorithm/extension/algorithm-guard.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "algorithm-guard-"));
process.env.HOME = home;
const guard = await import("./algorithm-guard.ts");
const { validatePrd, runDoctor, formatDoctor, findIsa, WORK_ROOT, ISA_CHECK_SCRIPT } = guard;
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

	// --- verified_by: loop_validate — цепочка артефактов engineering-loop ---
	const loopRepo = join(home, "loop-repo");
	const loopRuns = join(loopRepo, ".omp", "runtime", "engineering-loop");
	const LOOP_COMMIT = "a".repeat(40);
	const OTHER_COMMIT = "b".repeat(40);
	const TOKEN_A = "tok-loopA-Zz"; // имя каталога прогона — токен: не должно попадать в ошибки
	const TOKEN_B = "tok-loopB-Zz";
	const sha256 = (text) => createHash("sha256").update(text).digest("hex");
	const writeJsonNl = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
	const writeLoopRun = (token, commit) => {
		const dir = join(loopRuns, token);
		mkdirSync(dir, { recursive: true });
		writeJsonNl(join(dir, "state.json"), { candidateCommit: commit, status: "finalized" });
		const evidenceFile = join(dir, "evidence.json");
		writeJsonNl(evidenceFile, { token, candidateCommit: commit, exitCode: 0, passed: true });
		const evidenceHash = sha256(readFileSync(evidenceFile, "utf8"));
		writeJsonNl(join(dir, "attestation.json"), { verdict: "PASS", candidateCommit: commit, evidenceHash });
		const reviewFile = join(dir, "review.json");
		writeJsonNl(reviewFile, { token, candidateCommit: commit, evidenceHash, verdict: "approved", summary: "ok" });
		writeJsonNl(join(dir, "review-attestation.json"), { verdict: "APPROVED", candidateCommit: commit, reviewHash: sha256(readFileSync(reviewFile, "utf8")) });
	};
	const loopPrd = (fm) => complete({ ...base, fm: { verified_by: "loop_validate", loop_repo: loopRepo, loop_commit: LOOP_COMMIT, ...fm } });

	assert.ok(validatePrd(loopPrd({ loop_repo: undefined, loop_commit: undefined })).some((e) => e.includes("loop_repo")));
	assert.ok(validatePrd(loopPrd({ loop_commit: undefined })).some((e) => e.includes("loop_commit")));
	assert.ok(validatePrd(loopPrd({ loop_repo: "repo/relative" })).some((e) => e.includes("абсолютным")));
	assert.ok(validatePrd(loopPrd({ loop_commit: "abc123" })).some((e) => e.includes("40-hex")));
	const noRun = validatePrd(loopPrd({}));
	assert.ok(noRun.some((e) => e.includes("нет прогона")), noRun.join("|"));
	writeLoopRun(TOKEN_A, LOOP_COMMIT);
	assert.deepEqual(validatePrd(loopPrd({})), []);
	// Второй битый прогон на тот же коммит не отменяет валидный.
	writeLoopRun(TOKEN_B, LOOP_COMMIT);
	writeFileSync(join(loopRuns, TOKEN_B, "evidence.json"), "{broken");
	assert.deepEqual(validatePrd(loopPrd({})), []);
	// Подменённый evidence: хеши в attestation и review расходятся с байтами файла — reject в обоих прогонах.
	writeJsonNl(join(loopRuns, TOKEN_A, "evidence.json"), { token: TOKEN_A, candidateCommit: LOOP_COMMIT, exitCode: 1, passed: true });
	const tampered = validatePrd(loopPrd({}));
	assert.ok(tampered.some((e) => e.includes("attestation.json")), tampered.join("|"));
	writeLoopRun(TOKEN_A, LOOP_COMMIT);
	rmSync(join(loopRuns, TOKEN_A, "review-attestation.json"));
	rmSync(join(loopRuns, TOKEN_B, "review-attestation.json"));
	assert.ok(validatePrd(loopPrd({})).some((e) => e.includes("review-attestation.json")));
	writeLoopRun(TOKEN_A, LOOP_COMMIT);
	writeLoopRun(TOKEN_B, LOOP_COMMIT);
	const wrongCommit = validatePrd(loopPrd({ loop_commit: OTHER_COMMIT }));
	assert.ok(wrongCommit.some((e) => e.includes("нет прогона")), wrongCommit.join("|"));
	for (const errs of [noRun, tampered, wrongCommit]) {
		for (const e of errs) {
			assert.ok(!e.includes(TOKEN_A) && !e.includes(TOKEN_B), e);
		}
	}

	// partial/blocked/abandoned требуют Outcome.
	assert.ok(validatePrd(prd({ fm: { phase: "blocked" }, criteria: [[false, "ISC-1"]] })).some((e) => e.includes("## Outcome")));
	assert.deepEqual(validatePrd(prd({ fm: { phase: "blocked" }, criteria: [[false, "ISC-1"]], outcome: "Нужен доступ к PROD." })), []);

	// --- ISA проекта: complete требует отчёты isa-check без регрессий ---
	const { checkIsa } = await import("../isa-check.ts");
	const proj = join(home, "proj");
	mkdirSync(join(proj, "src"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: proj });
	const isaPath = join(proj, "ISA.md");
	writeFileSync(isaPath, "---\nproject: proj\n---\n## Core checks\n- [x] ISC-1: Флаг сборки существует\n  probe: test -f flag\n");
	writeFileSync(join(proj, "flag"), "");
	const baseRun = await checkIsa(isaPath, { now: new Date("2026-09-24T10:00:00Z") });
	rmSync(join(proj, "flag"));
	const brokenRun = await checkIsa(isaPath, { baseline: baseRun.reportPath, now: new Date("2026-09-24T11:00:00Z") });
	writeFileSync(join(proj, "flag"), "");
	const fixedRun = await checkIsa(isaPath, { baseline: baseRun.reportPath, now: new Date("2026-09-24T12:00:00Z") });
	const noBaselineRun = await checkIsa(isaPath, { now: new Date("2026-09-24T13:00:00Z") });
	const narrowedRun = await checkIsa(isaPath, { baseline: baseRun.reportPath, only: ["ISC-1"], now: new Date("2026-09-24T14:00:00Z") });
	const withIsa = (fm) => complete({ ...base, fm: { isa: isaPath, isa_baseline: baseRun.reportPath, ...fm } });

	assert.ok(validatePrd(withIsa({ isa_final: undefined })).some((e) => e.includes("нет `isa_final`")));
	assert.ok(validatePrd(withIsa({ isa_final: brokenRun.reportPath })).some((e) => e.includes("регрессии относительно baseline: ISC-1")));
	assert.ok(validatePrd(withIsa({ isa_final: noBaselineRun.reportPath })).some((e) => e.includes("без --baseline")));
	assert.ok(validatePrd(withIsa({ isa_final: baseRun.reportPath, isa_baseline: fixedRun.reportPath })).some((e) => e.includes("не позже")));
	assert.ok(validatePrd(withIsa({ isa: "proj/ISA.md", isa_final: fixedRun.reportPath })).some((e) => e.includes("абсолютным")));
	assert.ok(validatePrd(withIsa({ isa_final: narrowedRun.reportPath })).some((e) => e.includes("нужен прогон всего ISA")));
	assert.deepEqual(validatePrd(withIsa({ isa_final: fixedRun.reportPath })), []);

	// ISA ищется вверх от cwd до корня git.
	assert.equal(findIsa(join(proj, "src")), isaPath);
	const emptyRepo = join(home, "empty", "sub");
	mkdirSync(emptyRepo, { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: join(home, "empty") });
	assert.equal(findIsa(emptyRepo), null);

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

	// /isa-check: находит ISA от cwd, запускает раннер, уровень уведомления по коду выхода.
	mkdirSync(join(ISA_CHECK_SCRIPT, ".."), { recursive: true });
	symlinkSync(new URL("../isa-check.ts", import.meta.url).pathname, ISA_CHECK_SCRIPT);
	const ui = (sink) => ({ notify: (message, level) => sink.push({ message, level }) });
	const isaNotes = [];
	await commands["isa-check"].handler('--verbose --only "Core checks"', { cwd: join(proj, "src"), ui: ui(isaNotes) });
	assert.equal(isaNotes[0].level, "info", isaNotes[0].message);
	assert.match(isaNotes[0].message, /ISA proj: 1 pass · 0 fail/);
	rmSync(join(proj, "flag"));
	await commands["isa-check"].handler("", { cwd: proj, ui: ui(isaNotes) });
	assert.equal(isaNotes[1].level, "warning");
	assert.match(isaNotes[1].message, /✗ ISC-1/);
	await commands["isa-check"].handler("", { cwd: emptyRepo, ui: ui(isaNotes) });
	assert.match(isaNotes[2].message, /ISA\.md не найден/);

	// --- Nudge-слой ---
	const { destructiveOp, hasActivePrd } = guard;
	const bash = (command) => ["bash", { command }];
	const destructive = [
		bash(`psql "$DB" -c "DROP TABLE amocrm_loss_reasons"`),
		bash(`psql "$DB" -c 'delete from tasks where id = 1'`),
		bash("git push --force origin feature"),
		bash("git push origin :old-branch"),
		bash("git push -d origin feature"),
		bash("gh repo delete I1eanch/x --yes"),
		bash("gh api -X DELETE repos/I1eanch/x/hooks/1"),
		bash("curl -s -X DELETE https://api.example.com/v1/items/1"),
		bash("supabase db reset --linked"),
		bash("kubectl delete pod web-1"),
		["write", { path: "xd://mcp__n8n_archive_workflow", content: "{}" }],
		["write", { path: "xd://mcp__lific_delete", content: "{}" }],
	];
	for (const [tool, input] of destructive) assert.ok(destructiveOp(tool, input), JSON.stringify(input));
	const harmless = [
		bash(`grep -rn "DROP TABLE" supabase/migrations`),
		bash("git log --grep=delete --oneline"),
		bash(`echo "DELETE FROM tasks"`),
		bash("git push origin main"),
		bash("git push --follow-tags origin main"),
		bash("curl -s https://api.example.com/delete-requests"),
		bash("npm run test -- --reporter=dot"),
		["write", { path: "xd://mcp__n8n_search_workflows", content: "{}" }],
		["read", { path: "/tmp/DROP TABLE.txt" }],
	];
	for (const [tool, input] of harmless) assert.equal(destructiveOp(tool, input), null, JSON.stringify(input));

	// Экземпляр extension = сессия. Порог длинной сессии задаётся env до регистрации.
	process.env.ALGORITHM_NUDGE_CALLS = "5";
	process.env.ALGORITHM_NUDGE_FILES = "3";
	const session = (systemPrompt = []) => {
		const h = {};
		guard.default({ on: (name, handler) => { h[name] = handler; }, registerCommand: () => {} });
		h.before_agent_start({ prompt: "работаю", systemPrompt });
		const call = async (toolName, input, isError = false) => {
			const blocked = await h.tool_call({ toolName, toolCallId: "n", input }, ctx);
			const result = await h.tool_result({ toolName, toolCallId: "n", input, isError, content: [{ type: "text", text: "ok" }] }, ctx);
			return { blocked, result, nudge: result?.content?.at(-1)?.text ?? "" };
		};
		return { h, call };
	};
	assert.equal(hasActivePrd(), false);

	// Разрушающая операция без активного PRD: подсказка, результат не ошибка, вызов не блокирован; повтор — тишина.
	const s1 = session();
	const drop = await s1.call(...bash(`psql "$DB" -c "DROP TABLE x"`));
	assert.equal(drop.blocked, undefined);
	assert.match(drop.nudge, /разрушающая операция — SQL DROP[\s\S]*authority[\s\S]*baseline/);
	assert.equal(drop.result.isError, undefined);
	assert.equal((await s1.call(...bash(`psql "$DB" -c "DROP TABLE y"`))).result, undefined);
	assert.match((await s1.call(...bash("git push --force origin f"))).nudge, /git push с перезаписью/);
	// Неуспешная команда ничего не разрушила — подсказки нет.
	assert.equal((await session().call(...bash("gh repo delete x --yes"), true)).result, undefined);

	// Длинная сессия: одна подсказка на пороге вызовов, дальше тишина.
	const s2 = session();
	const quiet = [];
	for (let i = 0; i < 4; i += 1) quiet.push((await s2.call("read", { path: `/tmp/f${i}` })).result);
	assert.deepEqual(quiet, [undefined, undefined, undefined, undefined]);
	assert.match((await s2.call("read", { path: "/tmp/f5" })).nudge, /5 вызовов инструментов[\s\S]*PRD Algorithm не заведён/);
	assert.equal((await s2.call("read", { path: "/tmp/f6" })).result, undefined);

	// Порог по изменённым файлам.
	const s3 = session();
	for (const f of ["a", "b"]) assert.equal((await s3.call("write", { path: join(home, f), content: "x" })).result, undefined);
	assert.match((await s3.call("edit", { input: `[${join(home, "c")}#A1B2]\nPUT 1.=1:\n+x\n` })).nudge, /3 изменённых файлов/);

	// Запись PRD в сессии снимает подсказку длинной сессии.
	const s4 = session();
	await s4.call("write", { path: join(WORK_ROOT, "20260925-000000_nudge", "PRD.md"), content: "черновик" });
	for (let i = 0; i < 6; i += 1) assert.equal((await s4.call("read", { path: `/tmp/g${i}` })).result, undefined);

	// Активный PRD 4.1-omp на диске снимает обе подсказки.
	const activeDir = join(WORK_ROOT, "20260925-000001_active");
	mkdirSync(activeDir, { recursive: true });
	writeFileSync(join(activeDir, "PRD.md"), prd({ criteria: [[false, "ISC-1"]] }));
	assert.equal(hasActivePrd(), true);
	const s5 = session();
	assert.equal((await s5.call(...bash("kubectl delete pod web"))).result, undefined);
	for (let i = 0; i < 6; i += 1) assert.equal((await s5.call("read", { path: `/tmp/h${i}` })).result, undefined);
	rmSync(activeDir, { recursive: true });

	// Субагент и Advisor подсказок не получают.
	const sub = session(["base", "You are operating on a piece of work assigned to you by the main agent."]);
	assert.equal((await sub.call(...bash("terraform destroy -auto-approve"))).result, undefined);
	for (let i = 0; i < 6; i += 1) assert.equal((await sub.call("read", { path: `/tmp/s${i}` })).result, undefined);
	const adv = session();
	adv.h.before_agent_start({ prompt: "### Session update\n\n**agent**:\nидёт работа", systemPrompt: [] });
	for (let i = 0; i < 6; i += 1) assert.equal((await adv.call("read", { path: `/tmp/v${i}` })).result, undefined);

	// session_start сбрасывает счётчики и отметки: подсказка может прийти снова в новой сессии.
	s2.h.session_start();
	for (let i = 0; i < 4; i += 1) assert.equal((await s2.call("read", { path: `/tmp/r${i}` })).result, undefined);
	assert.match((await s2.call("read", { path: "/tmp/r5" })).nudge, /5 вызовов инструментов/);

	// Невалидная правка PRD на пороге длинной сессии: ошибка PRD остаётся ошибкой, а подсказки нет — PRD заведён.
	const s6 = session();
	for (let i = 0; i < 4; i += 1) await s6.call("read", { path: `/tmp/k${i}` });
	const both = await s6.call("edit", { input: `[${prdPath}#A1B2]\nPUT 3.=3:\n+phase: complete\n` });
	assert.equal(both.result.isError, true);
	assert.match(both.nudge, /complete при 1\/2/);
	assert.doesNotMatch(both.nudge, /подсказка/);

	console.log("algorithm-guard: all checks passed");
} finally {
	rmSync(home, { recursive: true, force: true });
}
