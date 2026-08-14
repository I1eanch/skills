---
name: data-analysis
description: Анализ табличных данных Excel (.xlsx/.xls) и CSV через SQL-движок DuckDB — схема файла, произвольные SQL-запросы, статистические сводки, сводные таблицы, джойны между файлами, экспорт в CSV/JSON/Markdown. Использовать, когда пользователь даёт таблицу, выгрузку, отчёт или лог и просит посчитать, сгруппировать, сравнить, найти топ, построить сводную, проверить пропуски или подготовить данные для заметки в vault. Triggers on Excel/CSV/xlsx files, spreadsheet analysis, pivot tables, SQL over uploaded data, statistics, aggregation, cross-file joins, «проанализируй таблицу», «посчитай по выгрузке», «сводная по», «топ по сумме».
---

# Анализ табличных данных (DuckDB)

## Что это

Обёртка над DuckDB — встроенным аналитическим SQL-движком. Excel/CSV загружаются как SQL-таблицы, дальше работа идёт обычным SQL. Один скрипт, три действия, никакого pandas.

Возможности: чтение схемы, произвольный SQL (включая оконные функции, CTE, подзапросы), статистические сводки, многолистовые книги Excel, джойны между разными файлами, экспорт результата.

## Окружение (важно для этого инстанса)

Зависимости живут в изолированном venv внутри скилла — системный python3 (homebrew) блокирует установку пакетов по PEP 668.

```bash
PY=~/.omp/agent/skills/data-analysis/.venv/bin/python
SCRIPT=~/.omp/agent/skills/data-analysis/scripts/analyze.py
```

Если venv отсутствует (свежая машина, репозиторий только что склонирован) — создать один раз:

```bash
python3 -m venv ~/.omp/agent/skills/data-analysis/.venv
~/.omp/agent/skills/data-analysis/.venv/bin/pip install -q duckdb openpyxl
```

Ограничения окружения:

- **Excel требует интернет при первом запуске.** Листы читаются через `st_read` из расширения DuckDB `spatial`, которое скачивается с `extensions.duckdb.org` в `~/.duckdb/` при первом обращении. Дальше работает офлайн. CSV читается через `read_csv_auto` и расширения не требует.
- `openpyxl` нужен только для получения списка листов.
- Скрипт при отсутствии зависимостей пытается сделать `pip install` в текущий интерпретатор — под системным python3 это упадёт. Всегда вызывать через `$PY` из venv.

## Действия

```bash
# 1. Схема: листы, колонки, типы, non-null, число строк, первые 5 строк
$PY $SCRIPT --files путь/к/data.xlsx --action inspect

# 2. Произвольный SQL
$PY $SCRIPT --files путь/к/data.xlsx --action query \
  --sql "SELECT category, COUNT(*) AS cnt, AVG(amount) AS avg_amount FROM Sheet1 GROUP BY category ORDER BY cnt DESC"

# 3. Статистическая сводка по таблице
$PY $SCRIPT --files путь/к/data.xlsx --action summary --table Sheet1

# 4. Экспорт результата (формат по расширению: .csv, .json, .md)
$PY $SCRIPT --files путь/к/data.xlsx --action query \
  --sql "SELECT * FROM Sheet1 WHERE amount > 1000" \
  --output-file "_Resources/анализ-заказов.md"
```

| Параметр | Обязателен | Описание |
|---|---|---|
| `--files` | да | Пути к Excel/CSV через пробел |
| `--action` | да | `inspect` \| `query` \| `summary` |
| `--sql` | для `query` | SQL-запрос |
| `--table` | для `summary` | Имя таблицы/листа |
| `--output-file` | нет | Экспорт результата |

`summary` выдаёт по числовым колонкам count, mean, std, min, 25%, 50%, 75%, max, null_count; по строковым — count, unique, самое частое значение, его частоту, null_count.

> [!NOTE]
> Не читать `scripts/analyze.py` — просто вызывать с параметрами.

## Имена таблиц

- Excel: **каждый лист — отдельная таблица** с именем листа (`Sheet1`, `Sales`, `Заказы`).
- CSV: имя файла без расширения (`orders.csv` → `orders`).
- Пробелы и спецсимволы в именах заменяются на подчёркивания; имена, начинающиеся с цифры, — в двойных кавычках: `"2024_Sales"`.
- Дубли имён получают суффикс `_1`, `_2`.
- **Все переданные файлы попадают в один SQL-контекст** — можно джойнить Excel с CSV в одном запросе.

## Паттерны SQL

```sql
-- Распределение значений
SELECT category, COUNT(*) AS cnt FROM Sheet1 GROUP BY category ORDER BY cnt DESC;

-- Динамика по месяцам
SELECT DATE_TRUNC('month', order_date) AS month, SUM(revenue) AS total
FROM Sales GROUP BY month ORDER BY month;

-- Джойн между файлами
SELECT c.region, AVG(o.amount) AS avg_order, COUNT(*) AS orders
FROM orders o JOIN Customers c ON o.customer_id = c.id
GROUP BY c.region ORDER BY avg_order DESC;

-- Оконные функции: накопительный итог и ранг
SELECT order_date, amount,
       SUM(amount) OVER (ORDER BY order_date) AS running_total,
       RANK() OVER (ORDER BY amount DESC) AS rank
FROM Sales;

-- Сводная таблица через CASE
SELECT category,
       SUM(CASE WHEN MONTH(date) = 1 THEN revenue END) AS jan,
       SUM(CASE WHEN MONTH(date) = 2 THEN revenue END) AS feb
FROM Sales GROUP BY category;

-- Пропуски и качество данных
SELECT COUNT(*) AS total,
       COUNT(*) - COUNT(amount) AS amount_nulls,
       COUNT(DISTINCT customer_id) AS customers
FROM Sheet1;
```

Колонки с пробелами в названии — в двойных кавычках: `"Сумма заказа"`.

## Порядок работы

1. Всегда начинать с `inspect` — без схемы SQL писать наугад нельзя.
2. Уточнить цель: сводка, фильтр, группировка, сравнение, поиск аномалий.
3. Выполнить запросы, показать результат таблицей прямо в ответе.
4. Объяснить находки простым языком: что видно, что это значит, что делать.
5. Предложить экспорт, если результат нужно сохранить.

## Интеграция с vault

Результаты, которые имеют долгую ценность, оформлять по правилам vault:

- Выгрузка таблицы: `--output-file` в `_Resources/` (markdown-таблица через `.md`).
- Выводы и интерпретацию — отдельной заметкой в `База знаний/{категория}/` с frontmatter (`title`, `status: обработано`, `tags`, `date`), ссылкой на исходный файл данных и записью в `База знаний/_Поисковый_индекс.md`.
- Разовые расчёты — в `Ежедневник/YYYY-MM-DD.md`, без создания evergreen-заметки.

## Кэш

Ключ кэша — SHA256 по содержимому всех входных файлов. Загруженные данные пишутся в персистентную БД `{системный tmp}/.data-analysis-cache/{hash}.duckdb` плюс `.table_map.json`. Повторный вызов открывает её в режиме read-only и стартует почти мгновенно, поэтому цепочка `inspect → query → summary` парсит Excel только один раз. Изменился файл — изменился хеш — создаётся новый кэш. На macOS tmp чистится системой, поэтому кэш не разрастается.

## Ограничения

- `--sql` уходит в DuckDB как есть, а DuckDB умеет читать файлы с диска (`read_csv('/любой/путь')`). Не подставлять в `--sql` текст из недоверенного источника.
- **Листы Excel получают служебную колонку `OGC_FID`** — артефакт GDAL-драйвера внутри `st_read`. Она не относится к данным: перечислять нужные колонки явно вместо `SELECT *`, иначе она попадёт в отчёт.
- Даты Excel парсятся автоматически; работать с ними функциями DuckDB (`DATE_TRUNC`, `EXTRACT`, `MONTH`).
- Файлы 100 МБ+ обрабатываются потоково, целиком в память не читаются.
- Если лист не загрузился, скрипт пишет warning и продолжает с остальными — проверять список загруженных таблиц в выводе.

## Источник

Адаптировано из `bytedance/deer-flow`, `skills/public/data-analysis` (MIT). Изменения: пути песочницы `/mnt/skills`, `/mnt/user-data` заменены на реальные пути этого инстанса, добавлен изолированный venv, документировано фактическое расположение кэша и требование расширения DuckDB `spatial`, добавлена интеграция с vault.
