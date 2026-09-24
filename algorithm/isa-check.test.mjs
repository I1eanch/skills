// Запуск: bun ~/.omp/agent/skills/algorithm/isa-check.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { checkIsa, formatReport, parseIsa } from "./isa-check.ts";

const root = mkdtempSync(join(tmpdir(), "isa-check-"));
const script = new URL("./isa-check.ts", import.meta.url).pathname;

const ISA = `---
isa: "1"
project: demo
---

# ISA — demo

## Сборка
- [x] ISC-1: Команда true завершается успешно
  probe: true
- [x] ISC-2: Запрещённая операция падает с нужной ошибкой
  probe: echo "permission denied for table" >&2; exit 1
  expect: fail /permission denied/
- [x] ISC-3: Версия выводится в stdout
  probe: echo "v1.2.3"
  expect: stdout /^v1\\.\\d+\\.\\d+$/
- [x] ISC-4: Отмеченное утверждение, которое сейчас ломается
  probe: exit 3
- [ ] ISC-5: Переменная из .env доступна проверке
  probe: test "$ISA_DEMO_TOKEN" = "секрет"

## Прод
- [x] ISC-6: Прод-проверка не запускается по умолчанию
  probe: touch prod-ran
  env: prod
- [ ] ISC-7: Письмо выглядит аккуратно
  probe: manual
- [ ] ISC-8: [DROPPED — см. Decisions]

## Таймаут
- [ ] ISC-9: Зависшая проверка убивается вместе с потомками
  probe: (sleep 2; touch late) & sleep 30
  timeout: 1
`;

try {
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "ISA.md"), ISA);
	writeFileSync(join(root, ".env"), 'ISA_DEMO_TOKEN="секрет"\n# comment\n');

	// Разбор: поля, разделы, статусы, DROPPED без probe не ошибка.
	const parsed = parseIsa(ISA);
	assert.deepEqual(parsed.errors, []);
	assert.equal(parsed.project, "demo");
	const byId = Object.fromEntries(parsed.claims.map((c) => [c.id, c]));
	assert.equal(byId["ISC-2"].expect.kind, "fail");
	assert.equal(byId["ISC-6"].env, "prod");
	assert.equal(byId["ISC-9"].timeoutSec, 1);
	assert.equal(byId["ISC-4"].section, "Сборка");
	assert.equal(byId["ISC-8"].dropped, true);

	// Ошибки формата: нет probe, неверный expect, дубль ID.
	const broken = parseIsa("## A\n- [ ] ISC-1: без проверки\n- [ ] ISC-2: кривой expect\n  probe: true\n  expect: exit 1\n- [ ] ISC-2: дубль\n  probe: true\n");
	assert.equal(broken.errors.length, 3, broken.errors.join("|"));

	const before = readFileSync(join(root, "ISA.md"), "utf8");
	const { report, errors, reportPath } = await checkIsa(join(root, "ISA.md"), { now: new Date("2026-09-24T10:00:00Z") });
	assert.deepEqual(errors, []);
	const outcome = Object.fromEntries(report.results.map((r) => [r.id, r]));

	assert.equal(outcome["ISC-1"].outcome, "pass");
	assert.equal(outcome["ISC-2"].outcome, "pass");
	assert.equal(outcome["ISC-3"].outcome, "pass");
	assert.equal(outcome["ISC-4"].outcome, "fail");
	assert.equal(outcome["ISC-5"].outcome, "pass", outcome["ISC-5"].detail);
	assert.equal(outcome["ISC-6"].outcome, "skipped");
	assert.equal(existsSync(join(root, "prod-ran")), false);
	assert.equal(outcome["ISC-7"].outcome, "manual");
	assert.equal(outcome["ISC-8"], undefined);
	assert.equal(outcome["ISC-9"].outcome, "fail");
	assert.equal(outcome["ISC-9"].timedOut, true);
	assert.deepEqual(report.summary, { pass: 4, fail: 2, manual: 1, skipped: 1 });
	assert.deepEqual(report.drift, ["ISC-4"]);

	// ISA.md не меняется, отчёт лежит в .isa/, .isa/ не виден git.
	assert.equal(readFileSync(join(root, "ISA.md"), "utf8"), before);
	assert.ok(reportPath.startsWith(join(root, ".isa", "runs")));
	assert.ok(existsSync(join(root, ".isa", "last.json")));
	const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
	assert.ok(!status.includes(".isa"), status);

	// Потомок зависшей проверки убит: файл late не появляется после таймаута.
	await Bun.sleep(2500);
	assert.equal(existsSync(join(root, "late")), false);

	// Ложные «проверка упала»: fail без совпадения, exit 0 при ожидании провала, stdout не тот.
	const neg = join(root, "neg");
	execFileSync("mkdir", ["-p", neg]);
	writeFileSync(join(neg, "ISA.md"), `## N
- [ ] ISC-1: fail не той ошибкой
  probe: echo other >&2; exit 1
  expect: fail /permission denied/
- [ ] ISC-2: fail, а команда прошла
  probe: echo "permission denied"
  expect: fail /permission denied/
- [ ] ISC-3: stdout не совпал
  probe: echo v2.0.0
  expect: stdout /^v1/
`);
	const negRun = await checkIsa(join(neg, "ISA.md"));
	assert.deepEqual(negRun.report.results.map((r) => r.outcome), ["fail", "fail", "fail"]);

	// Baseline: было pass, стало fail → регрессия; prod запускается только явно.
	writeFileSync(join(root, "ISA.md"), before.replace("probe: true\n", "probe: exit 1\n"));
	const second = await checkIsa(join(root, "ISA.md"), { baseline: reportPath, env: "all", now: new Date("2026-09-24T11:00:00Z") });
	assert.deepEqual(second.report.regressions, ["ISC-1"]);
	assert.equal(existsSync(join(root, "prod-ran")), true);
	const text = formatReport(second.report, second.reportPath);
	assert.match(text, /РЕГРЕССИИ относительно baseline: ISC-1/);
	assert.match(text, /Ручная проверка: ISC-7/);

	// Суженный финальный прогон не скрывает сломанное: всё, что проходило в baseline и не запускалось, — notRechecked.
	const narrowed = await checkIsa(join(root, "ISA.md"), { baseline: reportPath, only: ["ISC-3"], now: new Date("2026-09-24T12:00:00Z") });
	assert.deepEqual(narrowed.report.regressions, []);
	assert.deepEqual(narrowed.report.notRechecked, ["ISC-1", "ISC-2", "ISC-5"]);
	assert.deepEqual(narrowed.report.only, ["ISC-3"]);
	assert.match(formatReport(narrowed.report, narrowed.reportPath), /не перепроверены: ISC-1, ISC-2, ISC-5/);

	// Неизвестный --only и несуществующий baseline — ошибки аргументов, а не «0 pass».
	const typo = await checkIsa(join(root, "ISA.md"), { only: ["Сборк"] });
	assert.match(typo.errors.join("|"), /нет утверждений или разделов «Сборк»/);
	const noBase = await checkIsa(join(root, "ISA.md"), { baseline: join(root, "nope.json") });
	assert.match(noBase.errors.join("|"), /--baseline: файл не найден/);
	// Относительный baseline сохраняется в отчёте абсолютным.
	const relativeBaseline = relative(process.cwd(), reportPath);
	assert.ok(!relativeBaseline.startsWith("/"));
	const relRun = await checkIsa(join(root, "ISA.md"), { baseline: relativeBaseline, only: ["ISC-3"] });
	assert.equal(relRun.report.baseline, reportPath);

	// CLI: коды выхода 1 (провал) и 2 (ошибка формата).
	const cliFail = spawnSync("bun", [script, join(root, "ISA.md"), "--only", "ISC-4"], { encoding: "utf8" });
	assert.equal(cliFail.status, 1, cliFail.stderr);
	assert.match(cliFail.stdout, /0 pass · 1 fail/);
	writeFileSync(join(root, "bad.md"), "## A\n- [ ] ISC-1: без проверки\n");
	const cliFormat = spawnSync("bun", [script, join(root, "bad.md")], { encoding: "utf8" });
	assert.equal(cliFormat.status, 2);
	assert.match(cliFormat.stderr, /нет probe/);
	const cliOk = spawnSync("bun", [script, join(root, "ISA.md"), "--only", "Прод", "--env", "prod"], { encoding: "utf8" });
	assert.equal(cliOk.status, 0, cliOk.stdout + cliOk.stderr);

	// --- Кеш по inputs: повторный прогон без изменений не запускает тяжёлую проверку ---
	const cacheRoot = join(root, "cache-proj");
	execFileSync("mkdir", ["-p", join(cacheRoot, "src")]);
	execFileSync("git", ["init", "-q"], { cwd: cacheRoot });
	writeFileSync(join(cacheRoot, ".gitignore"), "*.log\n");
	writeFileSync(join(cacheRoot, "src", "a.txt"), "v1\n");
	const counter = join(root, "runs.count");
	writeFileSync(counter, "");
	writeFileSync(join(cacheRoot, "ISA.md"), `## Heavy
- [x] ISC-1: Исходники содержат маркер версии
  probe: echo run >> "${counter}"; grep -q '^v' src/a.txt
  inputs: src
- [ ] ISC-2: Кешированный провал сохраняет вывод
  probe: echo "boom-${"$"}{RANDOM}" >&2; echo run >> "${counter}"; exit 4
  inputs: src/a.txt
`);
	const runs = () => readFileSync(counter, "utf8").split("\n").filter(Boolean).length;
	const cacheIsa = join(cacheRoot, "ISA.md");

	const c1 = await checkIsa(cacheIsa);
	assert.equal(runs(), 2);
	assert.deepEqual(c1.report.results.map((r) => [r.outcome, r.cached]), [["pass", false], ["fail", false]]);

	const c2 = await checkIsa(cacheIsa);
	assert.equal(runs(), 2, "без изменений inputs проверки не запускаются");
	assert.deepEqual(c2.report.results.map((r) => [r.outcome, r.cached]), [["pass", true], ["fail", true]]);
	assert.equal(c2.report.results[1].exitCode, 4);
	assert.match(c2.report.results[1].detail, /из кеша[\s\S]*boom-/);
	assert.match(formatReport(c2.report, c2.reportPath), /из кеша 2/);

	// Игнорируемый git файл не сбрасывает кеш; новый неотслеживаемый файл в inputs — сбрасывает только ISC-1.
	writeFileSync(join(cacheRoot, "src", "debug.log"), "noise");
	await checkIsa(cacheIsa);
	assert.equal(runs(), 2);
	writeFileSync(join(cacheRoot, "src", "b.txt"), "new");
	const c3 = await checkIsa(cacheIsa);
	assert.equal(runs(), 3);
	assert.deepEqual(c3.report.results.map((r) => r.cached), [false, true]);

	// Изменение содержимого перезапускает; результат следует за кодом.
	writeFileSync(join(cacheRoot, "src", "a.txt"), "broken\n");
	const c4 = await checkIsa(cacheIsa);
	assert.equal(runs(), 5);
	assert.equal(c4.report.results[0].outcome, "fail");

	// cache: false (--no-cache) запускает всё.
	await checkIsa(cacheIsa, { cache: false });
	assert.equal(runs(), 7);

	// Смена самой проверки сбрасывает кеш, даже если inputs те же.
	writeFileSync(cacheIsa, readFileSync(cacheIsa, "utf8").replace("grep -q '^v' src/a.txt", "grep -q '^b' src/a.txt"));
	const c5 = await checkIsa(cacheIsa);
	assert.equal(runs(), 8);
	assert.equal(c5.report.results[0].outcome, "pass");

	// Таймаут не кешируется; inputs у manual — ошибка формата.
	writeFileSync(join(cacheRoot, "SLOW.md"), `## S\n- [ ] ISC-1: Зависает\n  probe: echo run >> "${counter}"; sleep 5\n  timeout: 1\n  inputs: src\n`);
	await checkIsa(join(cacheRoot, "SLOW.md"));
	await checkIsa(join(cacheRoot, "SLOW.md"));
	assert.equal(runs(), 10);
	assert.match(parseIsa("## M\n- [ ] ISC-1: Вкус\n  probe: manual\n  inputs: src\n").errors.join("|"), /inputs не применим к manual/);

	console.log("isa-check: all checks passed");
} finally {
	rmSync(root, { recursive: true, force: true });
}
