# skills

Личный монорепозиторий агентских скиллов для OMP. Корень репозитория совпадает с каталогом скиллов OMP — `~/.omp/agent/skills`, поэтому скиллы подключены на месте, без симлинков и копий.

В этом же каталоге лежат сторонние скиллы, установленные отдельно. Они не версионируются: `.gitignore` работает по принципу whitelist — по умолчанию игнорируется всё, свои скиллы включаются явными исключениями.

## Состав

| Скилл | Назначение |
|---|---|
| [`opensource-finder`](opensource-finder/) | Поиск уже пройденного пути: находит решение инженерной задачи в GitHub и опенсорсе и переносит его в локальный код проверяемой правкой |
| [`data-analysis`](data-analysis/) | Анализ Excel/CSV через SQL-движок DuckDB: схема, произвольные запросы, статистические сводки, джойны между файлами, экспорт в CSV/JSON/Markdown |
| [`consulting-analysis`](consulting-analysis/) | Консалтинговые отчёты уровня McKinsey/BCG в две фазы: каркас анализа с выбором моделей и требованиями к данным, затем финальный отчёт по собранным данным |
| [`systematic-literature-review`](systematic-literature-review/) | Систематический обзор литературы по arXiv: поиск работ, параллельное извлечение метаданных субагентами, синтез тем, отчёт в APA/IEEE/BibTeX |
| [`academic-paper-review`](academic-paper-review/) | Рецензия на одну научную статью уровня peer review: методология, вклад, позиционирование в литературе, рекомендации |
| [`deep-research`](deep-research/) | Многоракурсный веб-ресёрч в четыре фазы: разведка, углубление по измерениям, набор разных типов свидетельств, проверка полноты. Штатный поставщик данных для `consulting-analysis` |
| [`chart-visualization`](chart-visualization/) | Каталог 26 типов графиков: выбор уместного типа под характер данных и спецификация обязательных полей для каждого. Рендер — локальными средствами |
| [`newsletter-generation`](newsletter-generation/) | Дайджесты и рассылки: структуры под четыре формата, критерии отбора материалов, калибровка тона под аудиторию, чек-лист перед отправкой |

## Структура

```
.
├── .gitignore              # whitelist: игнорируется всё, кроме своих скиллов
├── README.md
├── opensource-finder/
│   ├── SKILL.md
│   ├── references/
│   └── agents/
├── data-analysis/
│   ├── SKILL.md
│   ├── scripts/analyze.py
│   └── .venv/              # локальное окружение, не версионируется
├── consulting-analysis/
│   └── SKILL.md            # только методология, без скриптов
├── systematic-literature-review/
│   ├── SKILL.md
│   ├── scripts/arxiv_search.py
│   ├── templates/          # apa, ieee, bibtex
│   └── evals/              # 5 сценариев + 20 триггер-кейсов
├── academic-paper-review/
│   └── SKILL.md
├── deep-research/
│   └── SKILL.md
├── chart-visualization/
│   ├── SKILL.md
│   └── references/          # 26 спецификаций типов графиков, переведены на русский
└── newsletter-generation/
    └── SKILL.md
```

Скиллы связаны в конвейер аналитики: `consulting-analysis` строит каркас с требованиями к данным → `deep-research` и `data-analysis` собирают факты и числа → `chart-visualization` выбирает типы графиков → рендер локальными средствами → `consulting-analysis` собирает финальный отчёт. Академическая доказательная база при необходимости приходит из `systematic-literature-review` и `academic-paper-review`. `newsletter-generation` использует тот же сбор через `deep-research`, но упаковывает результат не в отчёт, а в выпуск рассылки.

Каждый скилл — каталог с `SKILL.md`, где frontmatter (`name`, `description`) определяет, когда агент его подхватит. Описание пишется двуязычным: русские формулировки задач плюс английские технические триггеры, чтобы срабатывало независимо от языка запроса.

## Развёртывание на новой машине

Каталог `~/.omp/agent/skills` обычно уже существует и не пуст, поэтому обычный `git clone` в него не сработает. Порядок такой:

```bash
cd ~/.omp/agent/skills
git init
git remote add origin https://github.com/I1eanch/skills.git
git fetch origin
git checkout -f main
```

Затем поднять окружение скиллов, которым оно нужно:

```bash
# data-analysis
python3 -m venv ~/.omp/agent/skills/data-analysis/.venv
~/.omp/agent/skills/data-analysis/.venv/bin/pip install -q duckdb openpyxl
```

## Соглашения

- Скиллы, требующие python-зависимостей, держат изолированный `.venv` внутри своего каталога: системный python (homebrew) блокирует установку пакетов по PEP 668. Путь к интерпретатору указывается прямо в `SKILL.md`.
- Схема `skill://` не разворачивается в аргументах shell-команд, поэтому в `SKILL.md` пишутся абсолютные пути вида `~/.omp/agent/skills/<имя>/scripts/...`.
- Адаптированные сторонние скиллы содержат раздел «Источник» с указанием происхождения, лицензии и списком внесённых изменений.
- Скилл не считается готовым без смоук-теста на реальных данных: команды из `SKILL.md` должны быть фактически выполнены, а найденные расхождения с документацией — записаны в сам скилл.

## Происхождение

Репозиторий вырос из форка [`Jia-Ethan/pavedpath-code`](https://github.com/Jia-Ethan/pavedpath-code) и был переименован в `skills`, поэтому GitHub сохраняет пометку fork. Скилл `data-analysis` адаптирован из [`bytedance/deer-flow`](https://github.com/bytedance/deer-flow) (`skills/public/data-analysis`, MIT).
