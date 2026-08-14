---
name: systematic-literature-review
description: Систематический обзор литературы по научным статьям arXiv — поиск публикаций по теме, извлечение структурированных метаданных из каждой работы, синтез тем поперёк всего набора и отчёт с оформленными ссылками в APA, IEEE или BibTeX. Использовать при запросах «сделай обзор литературы», «что пишут в статьях про», «сравни методологии в работах по», «обзор исследований», «аннотированная библиография», «survey по теме», «systematic literature review», «SLR». Не подходит для разбора одной конкретной статьи — там нужен обзор одной работы, а не синтез многих.
---

# Systematic Literature Review Skill

## Overview

This skill produces a structured **systematic literature review (SLR)** across multiple academic papers on a research topic. Given a topic query, it searches arXiv, extracts structured metadata (research question, methodology, key findings, limitations) from each paper in parallel, synthesizes themes across the full set, and emits a final report with consistent citations.

**Distinct from `academic-paper-review`:** that skill does deep peer review of a single paper. This skill does breadth-first synthesis across many papers. If the user hands you one paper URL and asks "review this paper", route to `academic-paper-review` instead.

## When to Use This Skill

Use this skill when the user wants any of the following:

- A literature survey on a topic ("survey transformer attention variants", "review the literature on diffusion models")
- A synthesis across multiple papers ("what do recent papers say about X", "compare methodologies across papers on Y")
- A systematic review with consistent citation format ("do an SLR on Z in APA format")
- An annotated bibliography on a topic
- An overview of research trends in a field over a time window

Do **not** use this skill when:

- The user provides exactly one paper and asks to review it (use `academic-paper-review`)
- The user asks a factual question that does not require synthesizing multiple sources (answer directly)
- The user wants general web research without academic rigor (use standard web search)

## Workflow

The workflow has five phases. Follow them in order.

### Phase 1: Plan

Before doing any retrieval, confirm the following with the user. If any of these are unclear, ask **one** clarifying question that covers the missing pieces. Do not ask one question at a time.

- **Topic**: the research area in plain English (e.g. "transformer attention variants").
- **Scope**: how many papers (default 20, hard upper bound 50), optional time window (e.g. "last 2 years"), optional arXiv category (e.g. `cs.CL`, `cs.CV`).
- **Citation format**: APA, IEEE, or BibTeX (default APA if the user does not specify and does not seem to be writing for a specific venue).
- **Output location**: where to save the final report. Default for this instance — the vault: `База знаний/Исследования/` for an evergreen review, or `Ежедневник/YYYY-MM-DD.md` for a throwaway one.

If the user says "50+ papers", politely cap it at 50 and explain that synthesis quality degrades quickly past that — for larger surveys they should split by sub-topic.

### Phase 2: Search arXiv

Call the bundled search script. Do **not** try to scrape arXiv by other means and do **not** write your own HTTP client — this script handles URL encoding, Atom XML parsing, and id normalization correctly.

```bash
python3 ~/.omp/agent/skills/systematic-literature-review/scripts/arxiv_search.py \
  "<topic>" \
  --max-results <N> \
  [--category <cat>] \
  [--sort-by relevance] \
  [--start-date YYYY-MM-DD] \
  [--end-date YYYY-MM-DD]
```

**IMPORTANT — extract 2-3 core keywords before searching.** Do not pass the user's full topic description as the query. Before calling the script, mentally reduce the topic to its 2-3 most essential terms. Drop qualifiers like "in computer vision", "for NLP", "variants", "recent" — those belong in `--category` or `--start-date`, not in the query string.

**Query phrasing — keep it short.** The script wraps multi-word queries in double quotes for phrase matching on arXiv. This means:

- `"diffusion models"` → searches for the exact phrase → good, returns relevant papers.
- `"diffusion models in computer vision"` → searches for that exact 5-word phrase → **too specific, likely returns 0 results** because few papers contain that exact string.

Use **2-3 core keywords** as the query, and use `--category` to narrow the field instead of stuffing field names into the query. Examples:

| User says | Good query | Bad query |
|---|---|---|
| "diffusion models in computer vision" | `"diffusion models" --category cs.CV` | `"diffusion models in computer vision"` |
| "transformer attention variants" | `"transformer attention"` | `"transformer attention variants in NLP"` |
| "graph neural networks for molecules" | `"graph neural networks" --category cs.LG` | `"graph neural networks for molecular property prediction"` |

The script prints a JSON array to stdout. Each paper has: `id`, `title`, `authors`, `abstract`, `published`, `updated`, `categories`, `pdf_url`, `abs_url`.

**Sort strategy**:

- **Always use `relevance` sorting** — arXiv's BM25-style scoring ensures results are actually about the user's topic. `submittedDate` sorting returns the most recently submitted papers in the category regardless of topic relevance, which produces mostly off-topic results.
- When the user asks for "recent" papers or gives a time window, use `--sort-by relevance` **combined with `--start-date`** to constrain the time range while keeping results on-topic. For example, "recent diffusion model papers" → `--sort-by relevance --start-date 2024-01-01`, not `--sort-by submittedDate`.
- `submittedDate` sorting is only appropriate when the user explicitly asks for chronological order (e.g. "show me papers in the order they were published"). This is rare.
- `lastUpdatedDate` is rarely useful; ignore it unless the user asks.

**Run the search exactly once.** Do not retry with modified queries if the results seem imperfect — arXiv's relevance ranking is what it is. Retrying with different query phrasings wastes tool calls and risks hitting the recursion limit. If the results are genuinely empty (0 papers), tell the user and suggest they broaden their topic or remove the category filter.

**If the script returns fewer papers than requested**, that is the real size of the arXiv result set for the query. Do not pad the list — report the actual count to the user and proceed.

**If the script fails** (network error, non-200 from arXiv), tell the user which error and stop. Do not try to fabricate paper metadata.

**Do not save the search results to a file** — the JSON stays in your context for Phase 3. The only file saved during the entire workflow is the final report in Phase 5.

### Phase 3: Extract metadata in parallel

**You MUST delegate extraction to subagents via the `task` tool — do not extract metadata yourself.** This is non-negotiable. Specifically, do NOT do any of the following:

- ❌ Write `python -c "papers = [...]"` or any Python/bash script to process papers
- ❌ Extract metadata inline in your own context by reading abstracts one by one
- ❌ Use any tool other than `task` for this phase

Instead, you MUST call the `task` tool to spawn subagents. The reason: extracting 10-50 papers in your own context consumes too many tokens and degrades synthesis quality in Phase 4. Each subagent runs in an isolated context with only its batch of papers, producing cleaner extractions.

Split papers into batches of ~5 and dispatch every batch in **one** `task` call, passing all batches as a single `tasks[]` array. Use `agent: "scout"` — extraction is read-only text work and the scout runs a faster model. Set `effort: "lo"`: the job is transcription of abstracts into fields, not reasoning.

**Concurrency: this instance allows up to 32 concurrent subagents**, so the hard bound of 50 papers means 10 batches — a single wave, no rounds. Do not serialize batches and do not shrink the batch list to "be safe": dispatching 10 subagents in one `tasks[]` array is the correct behaviour here.

Give every task an `outputSchema` so results come back as parsed objects instead of free text:

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["arxiv_id", "title", "authors", "published_date", "research_question", "methodology", "key_findings", "limitations"],
    "properties": {
      "arxiv_id": { "type": "string" },
      "title": { "type": "string" },
      "authors": { "type": "array", "items": { "type": "string" } },
      "published_date": { "type": "string" },
      "research_question": { "type": "string" },
      "methodology": { "type": "string" },
      "key_findings": { "type": "array", "items": { "type": "string" } },
      "limitations": { "type": "string" }
    }
  }
}
```

**Do the batching at the main-agent level**: you already have every paper's abstract from Phase 2, so each subagent receives pure text input. Subagents need neither network nor filesystem access — their only job is to read text and return structured data. Never ask a subagent to re-run `arxiv_search.py`; that wastes tokens and risks rate-limiting.

Pass abstracts inside the task prompt. If the combined text is large, write it to `local://slr-batch-<N>.md` and name that URI in the prompt instead of inlining it.

**What each subagent receives**, as a structured prompt:

```
Execute this task: extract structured metadata and key findings from the
following arXiv papers.

Papers:
[Paper 1]
arxiv_id: 1706.03762
title: Attention Is All You Need
authors: Ashish Vaswani, Noam Shazeer, ...
published: 2017-06-12
abstract: <full abstract text>

[Paper 2]
arxiv_id: ...
...

For each paper, return a JSON object with these fields:
- arxiv_id (string)
- title (string)
- authors (list of strings)
- published_date (string, YYYY-MM-DD)
- research_question (1 sentence, what problem the paper tackles)
- methodology (1-2 sentences, how they tackle it)
- key_findings (3-5 bullet points, what they actually found)
- limitations (1-2 sentences, what they acknowledge or what is obviously missing)

Return the result as a JSON array, one object per paper, in the same
order as the input. Do not include any text outside the JSON — no
preamble, no markdown fences, just the array.
```

**Collecting results**: results auto-deliver when the wave finishes; a settled `hub jobs` / `hub wait` snapshot is the delivery. With `outputSchema` set, each result arrives as parsed data — no prefix stripping is needed. If a batch fails or returns an invalid payload, note which papers were affected and continue with the remaining batches — one bad batch must not fail the whole synthesis.

Flatten the per-batch arrays into a single list of paper metadata objects, preserving input order.

### Phase 4: Synthesize and format

Now produce the final SLR report. Two things happen here: cross-paper synthesis (thematic analysis) and citation formatting.

**Cross-paper synthesis**: the report must do more than list papers. At minimum, identify:

- **Themes**: 3-6 recurring research directions, approaches, or problem framings across the set.
- **Convergences**: findings that multiple papers agree on.
- **Disagreements**: where papers reach different conclusions or use incompatible methodologies.
- **Gaps**: what the collective literature does not yet address (often stated explicitly in the "limitations" fields).

If the paper set is too small or too heterogeneous to support thematic synthesis (e.g. 5 papers on wildly different sub-topics), say so explicitly in the report — do not force themes that are not there.

**Citation formatting**: the exact format depends on user preference. Read **only** the template file that matches the user's requested format, not all three:

- [templates/apa.md](templates/apa.md) — APA 7th edition. Default for social sciences and most CS journals. Use when the user requests APA or does not specify a format.
- [templates/ieee.md](templates/ieee.md) — IEEE numeric citations. Use when the user targets an IEEE conference or journal, or explicitly asks for IEEE.
- [templates/bibtex.md](templates/bibtex.md) — BibTeX entries. Use when the user mentions BibTeX, LaTeX, or wants machine-readable references. **Important**: arXiv papers are cited as `@misc`, not `@article` — the BibTeX template covers this explicitly.

Each template contains both the citation rules and a full report structure (executive summary, themes, per-paper annotations, references, methodology section). Follow the template's structure verbatim for the report body, then fill in content from your Phase 3 metadata.

### Phase 5: Save and present

Save the full report to the vault as `База знаний/Исследования/YYYY-MM-DD Обзор литературы — <тема>.md` with frontmatter (`title`, `status: обработано`, `tags`, `date`), then add an entry to `База знаний/_Поисковый_индекс.md`. For a throwaway review, append it to `Ежедневник/YYYY-MM-DD.md` instead and create no evergreen note. State the saved path in the chat message — there is no separate file-presentation tool in this instance.

**In the chat message**, show a short preview so the user immediately sees value without opening the file:

1. **Executive summary** — the 3–5 sentence paragraph from the top of the report, verbatim.
2. **Themes list** — bullet list of the themes you identified in Phase 4 synthesis (just the theme names + one-line gloss, not the full theme sections).
3. **Paper count + a pointer to the file** — e.g. "Full report with 20 papers, per-paper annotations, and formatted references saved to `slr-transformer-attention-20260409.md`."

Do **not** dump the full 2000+ word report inline — per-paper annotations, references, and methodology belong in the file. The preview is there to let the user judge the report at a glance and decide whether to open it.

## Examples

**Example 1: Typical SLR request**

User: "Do a systematic literature review of recent transformer attention variants, 20 papers, APA format."

Your flow:
1. Phase 1: confirm topic (transformer attention variants), scope (20 papers, default time window), format (APA). Ask **one** clarification only if something is missing (e.g. "Any particular time window, or should I default to the last 3 years?").
2. Phase 2: `arxiv_search.py "transformer attention" --max-results 20 --sort-by relevance --start-date 2023-01-01`.
3. Phase 3: 20 papers → 4 batches of 5 → one `task` call with 4 scout subagents in a single `tasks[]` array. Aggregate.
4. Phase 4: read `templates/apa.md`, write the report using its structure, fill in themes + per-paper annotations from Phase 3 metadata.
5. Phase 5: save to `База знаний/Исследования/2026-04-09 Обзор литературы — трансформерные механизмы внимания.md`, add an index entry, report the path.

**Example 2: Small-set request with ambiguity**

User: "Survey a few papers on diffusion models for me."

Your flow:
1. Phase 1: "a few" is ambiguous. Ask one question: "How many papers would you like — 10, 20, or 30? And any citation format preference (APA is the default)?"
2. User responds "10, BibTeX".
3. Phase 2: `arxiv_search.py "diffusion models" --max-results 10 --category cs.CV`.
4. Phase 3: 10 papers → 2 batches of 5 → one `task` call with 2 scout subagents.
5. Phase 4: read `templates/bibtex.md`, format with `@misc` entries (not `@article`).
6. Phase 5: save to the vault and report the path.

**Example 3: Out-of-scope request**

User: "Here's one paper (https://arxiv.org/abs/1706.03762). Can you review it?"

This is a single-paper peer review, not a literature survey. Do not use this skill. Route to `academic-paper-review` instead.

## Notes

- **Phase 3 needs the `task` tool.** It is available in this instance; extraction is delegated to `scout` subagents. If delegation is impossible for some reason, say so instead of silently extracting 50 abstracts inline — that is what degrades Phase 4 synthesis.
- **arXiv only, by design**. This skill does not query Semantic Scholar, PubMed, or Google Scholar. arXiv covers the bulk of CS/ML/physics/math preprints, which is what DeerFlow users most often want to survey. Multi-source academic search belongs in a dedicated MCP server, not inside this skill.
- **Hard upper bound of 50 papers**. Not a concurrency limit here (32 subagents are available) but a synthesis-quality limit: past ~50 papers a single review stops holding together. Larger surveys are split by sub-topic.
- **The report language follows the user's language.** For a Russian-speaking user the review body, themes and annotations are written in Russian; paper titles, author names and citation entries stay in their original language, since a citation must be resolvable.
- **The `id` field is a bare arXiv id** (e.g. `1706.03762`), not a URL and not with a version suffix. `abs_url` / `pdf_url` hold the full URLs if you need them.
- **Synthesis, not listing**. The final report must identify themes and compare findings across papers. A report that only lists papers one after another is a failure mode — if you cannot find themes, say so explicitly instead of faking them.

## Источник

Адаптировано из `bytedance/deer-flow`, `skills/public/systematic-literature-review` (MIT). Без изменений сохранены: правила формулирования запроса к arXiv (2–3 ключевых слова, уточнения через `--category` и `--start-date`), запрет на повторные поиски, требование синтеза вместо перечисления, три шаблона цитирования и оба набора evals.

Изменения адаптации:

- Путь скрипта заменён на реальный, `python` → `python3` (скрипт работает на системном интерпретаторе: есть fallback на `urllib`, отдельный venv не нужен).
- Фаза 3 переписана под параллелизм этого инстанса: вместо таблицы раундов под лимит 3 субагента DeerFlow — одна волна до 10 батчей в единственном `task` вызове, агент `scout`, `effort: "lo"`, `outputSchema` для структурированного результата.
- Убраны отсылки к рантайму DeerFlow: флаг `subagent_enabled`, парсинг префиксов `Task Succeeded. Result:`, инструмент `present_files`.
- Место сохранения отчёта заменено с `/mnt/user-data/outputs/` на vault: `База знаний/Исследования/` с frontmatter и записью в `_Поисковый_индекс.md`, разовый обзор — в `Ежедневник/`.
- Добавлено правило языка отчёта: текст на языке пользователя, названия работ и записи в списке литературы — в оригинале.
- В `description` добавлены русские триггеры.
