<!-- markdownlint-disable MD013 MD033 -->

<h1 align="center">PavedPath Code</h1>

<p align="center">
  PavedPath Code（代码版）is a Codex skill for finding proven implementation paths from GitHub and open-source evidence, then adapting them to local software engineering problems.
</p>

<p align="center">
  <a href="#简体中文">简体中文</a>
  ·
  <a href="#english">English</a>
  ·
  <a href="#migration">Migration</a>
  ·
  <a href="#license">License</a>
</p>

<p align="center">
  <img alt="Codex skill" src="https://img.shields.io/badge/Codex-skill-111827?style=flat-square">
  <img alt="PavedPath Code" src="https://img.shields.io/badge/PavedPath-Code-7c3aed?style=flat-square">
  <img alt="GitHub CLI first" src="https://img.shields.io/badge/GitHub%20CLI-first-0969da?style=flat-square">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-green?style=flat-square">
  <img alt="Status public skill" src="https://img.shields.io/badge/status-public%20skill-blue?style=flat-square">
</p>

> **Status boundary / 状态边界**
>
> PavedPath Code is the code-focused edition of PavedPath. It helps agents solve software engineering problems by finding proven implementation paths from GitHub repositories, issues, pull requests, discussions, code examples, release notes, and open-source evidence.
>
> PavedPath Code（代码版）用于解决代码、工程、依赖、构建、部署、集成、API 使用等问题。它不是泛泛搜索 GitHub，而是从开源项目、issue、PR、示例、release notes 等证据中找到已经被验证过的实现路径，再转译成本地可执行方案。
>
> This repository is not the future general-purpose PavedPath. Non-code life decisions, self-media workflows, study methods, consumer decisions, and broad research tasks are out of scope here.

## 友链 / Community

本项目接受 LINUX DO 社区佬友监督与反馈：[LINUX DO](https://linux.do/)

## 简体中文

### 项目定位

PavedPath Code（代码版）帮助 Agent 避免为代码问题重复造轮子。它先定义本地工程问题，再用 GitHub 和开源证据寻找已经被走通的路径：成熟项目、issue、PR、discussion、代码、示例、release notes 和官方项目文档。最后，它把最强证据转译为本地最小适配、验证命令和风险边界。

它不是“搜索 GitHub 链接”的工具。GitHub 是主要证据源，目标是找到开源世界已经验证过的实现路径，并判断这条路径是否适合当前代码库。

### 适用范围

适合使用 PavedPath Code：

- bug、runtime error、build/test/deploy failure；
- dependency、SDK、framework、API usage 或 integration blocker；
- 需要寻找实现模式、配置形态、测试夹具、迁移路径或工具/库选型；
- 需要比较多个开源项目，并说明 Stars、license、活跃度、适配成本和风险；
- 需要从 issue、PR、release notes、示例代码或测试中提取可落地的修复模式；
- 需要回答“这个工程问题在开源世界是否已有可验证路径”。

不要用于：

- 文案、小型本地重构、或代码库已经明确给出答案的改动；
- 非代码问题、生活问题、自媒体工作流、学习方法、消费决策等未来通用版 PavedPath 才应覆盖的场景；
- 用户明确禁止联网或 GitHub 研究的任务；
- 未获授权的私有仓库、凭证、cookie、token、公司内部代码、敏感日志、production data 或不可公开上下文；
- 生产事故尚未完成本地日志、运行状态和官方文档核对时，用开源搜索替代现场排障。

### Features

| 能力 | 已包含内容 | 边界 |
| --- | --- | --- |
| GitHub CLI first | 默认使用 `gh search repos`、`gh search issues`、`gh search prs`、`gh search code`、`gh repo view`、`gh pr view`、`gh issue view` 和 `gh api` | 不依赖仓库内置搜索脚本；`gh` 结果仍需深读和本地验证 |
| 问题证据搜索 | 围绕错误文本、包名、API 名、版本号、配置键、框架和失败命令搜索 issues、PRs、code、examples、release notes | 只把 GitHub 当证据来源，不把链接数量或 Stars 当成结论 |
| 仓库候选研究 | 按问题匹配、Stars、license、活跃度、示例质量和适配成本比较公开仓库 | Stars 是成熟度信号，不会覆盖 maintainer evidence、merged PR、official examples 或可复现代码 |
| 条件子代理研究 | 当问题跨多个生态、查询族或证据面时，可拆给子代理并行只读研究 | 子代理不是默认强制；controller 仍负责范围控制、去重、排序、本地适配和最终验证 |
| 输出证据闭环 | `SKILL.md` 要求记录 search path、subagent used/skipped、key evidence、rejected options、verification standard | 使用子代理时必须留下 subagent trace，避免“搜了很多”但没有可复核证据 |
| Codex 集成 | `agents/openai.yaml` 提供展示信息和默认 prompt | 仍需要用户在本机 Codex skill 目录中安装 |

### 工作流

```mermaid
flowchart LR
  A["Local software engineering problem"] --> B["Frame symptom, versions, constraints"]
  B --> C["Search GitHub and open-source evidence"]
  C --> D["Rank evidence and repositories"]
  D --> E["Deep-read strongest matches"]
  E --> F["Extract proven path and risks"]
  F --> G["Map to local adaptation"]
  G --> H["Verify with tests, builds, requests, or logs"]
```

默认研究路径：

1. 先在本地定义问题：目标、症状、错误文本、版本、运行环境、约束和已尝试方案。
2. 选择证据面：错误和回归优先搜 issue/PR/release/code；能力选型优先搜仓库候选；实现卡点两者都用。
3. 判断是否需要子代理。只有当任务跨多个独立生态、查询族或证据面时才拆分；否则说明跳过原因。
4. 用 `gh` 和精确查询搜索公开 GitHub：错误文本、包名、API 名、版本号、配置键、框架和失败命令。
5. 按问题匹配度、证据强度、本地适用性、可操作性和项目成熟度排序。
6. 深读最强候选，提取可复用接口、配置、测试、工作流、风险和 license 边界。
7. 合并、去重并拒绝不适配候选；使用子代理时由 controller 直接核验关键 claim。
8. 输出本地修复或实施建议，并用测试、构建、真实请求、日志或人工检查完成验证标准。

### Installation

安装到默认 Codex skill 目录：

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/Jia-Ethan/pavedpath-code.git \
  ~/.codex/skills/pavedpath-code
```

更新已有安装：

```bash
git -C ~/.codex/skills/pavedpath-code pull --ff-only
```

建议按需安装并登录 GitHub CLI：

```bash
gh auth status
```

这个 skill 不绑定任何具体模型。它吸收了多 agent 搜索建议，但保持模型无关；真正的约束在于问题拆分、证据链接、去重、controller 复核和本地验证。

### Usage examples

在 Codex 中调用 skill：

```text
Use $pavedpath-code to investigate this Vite build error.
Find matching GitHub issues, merged PRs, release notes, and reusable fixes,
then recommend the smallest local adaptation and verification command.
```

搜索仓库候选：

```bash
gh search repos "browser automation agent" \
  --archived=false \
  --sort stars \
  --order desc \
  --limit 10 \
  --json fullName,url,description,stargazersCount,forksCount,language,license,pushedAt,isArchived,openIssuesCount
```

搜索某个仓库内的 issue：

```bash
gh search issues '"Cannot find module" "Node.js 22"' \
  --repo owner/repo \
  --sort updated \
  --order desc \
  --limit 10 \
  --json title,url,state,updatedAt,commentsCount,repository,body
```

搜索 merged PR：

```bash
gh search prs '"ERR_PACKAGE_PATH_NOT_EXPORTED" vite plugin' \
  --repo owner/repo \
  --merged \
  --sort updated \
  --order desc \
  --limit 10 \
  --json title,url,state,updatedAt,commentsCount,repository,body
```

查看仓库基本信息：

```bash
gh repo view owner/repo \
  --json nameWithOwner,url,description,stargazerCount,forkCount,licenseInfo,primaryLanguage,pushedAt,repositoryTopics,homepageUrl
```

### Output contract

当 PavedPath Code 实质影响结论时，回答应包含：

- 本地问题画像：目标、症状、版本、环境和约束。
- 搜索路径：查询词、搜索面、候选来源，以及是否使用或跳过子代理。
- 子代理 trace：仅在使用子代理时输出，包含 scope、evidence surfaces、key findings、rejected candidates、deduplication results、controller verified claims。
- 候选项目：repo、Stars、forks、语言、license、活跃度、基本内容、匹配理由和适配成本。
- 关键证据：issue、PR、代码、示例、release notes 或文档链接，以及为什么匹配。
- 推荐方案：直接复用什么、本地适配什么、避免复制什么。
- 风险和拒绝项：旧版本、不适配、license、隐私、安全或部署风险。
- 验证标准：测试、构建、复现命令、真实请求或人工检查。
- 置信度：证据弱或没有强匹配时必须明确说明。

### Security

- 默认只研究公开 GitHub 内容。私有仓库必须由用户明确授权并限定范围。
- 不要把 GitHub token、cookie、密码、API key、私有仓库内容、内部上下文、敏感日志、production data 或凭证写入 prompt、输出、日志、README、脚本或记忆文件。
- 不要把 token、cookie、私有仓库内容、敏感日志、secrets、production data 或凭证交给子代理。
- 只有在 `gh` 命令明确出现 403、429、私有仓库授权错误或未登录提示时，才需要检查 `gh auth status`。
- 避免复制大段第三方代码。优先复用公开 API、配置形态、工作流、测试模式和架构思路；如需代码复用，先检查 license 和归属要求。
- 对安全、支付、鉴权、基础设施或生产运维类问题，GitHub 证据必须与当前官方文档或官方仓库交叉验证。

### Roadmap

当前已包含：

- Codex skill 主入口：`SKILL.md`
- OpenAI agent metadata：`agents/openai.yaml`
- 研究评分和提取参考：`references/`
- GitHub CLI first 的查询模板和输出契约
- 条件式 subagent / parallel research guidance

可改进方向：

- 增加更结构化的 JSON schema 输出。
- 增加针对常见语言生态的查询模板。
- 增加离线示例夹具，方便在不访问 GitHub API 时演示输出格式。
- 增加 CI，检查 Markdown 链接、格式和敏感信息模式。

不会承诺：

- 自动修复本地代码。
- 自动判断所有 GitHub 结果真假。
- 保证每个工程问题都有公开答案。
- 在未授权范围内读取或复制私有代码。

## English

### Project positioning

PavedPath Code is the code-focused edition of PavedPath. It helps agents avoid reinventing solutions for software engineering problems by finding proven implementation paths from GitHub repositories, issues, pull requests, discussions, code examples, release notes, and open-source evidence.

It is not a generic GitHub link search. GitHub is the primary evidence source; the goal is to find a path the open-source world has already walked, decide whether it fits the local codebase, and adapt the strongest pattern with minimal, verifiable changes.

This repository is intentionally scoped to code and engineering work. The future general-purpose PavedPath is out of scope.

### Scope

Use PavedPath Code for:

- bugs, runtime errors, build/test/deploy failures;
- dependency, SDK, framework, API usage, or integration blockers;
- implementation patterns, configuration shapes, test fixtures, migration paths, or engineering tool/library selection;
- comparing open-source projects by Stars, license, activity, fit, adaptation cost, and risk;
- extracting actionable fixes from issues, PRs, release notes, examples, or tests;
- answering whether a concrete engineering problem already has a proven open-source path.

Do not use it for:

- copy edits, tiny local refactors, or changes where the existing codebase already dictates the answer;
- non-code life decisions, self-media workflows, study methods, consumer decisions, or broad general research;
- tasks where the user explicitly forbids network or GitHub research;
- unauthorized private repositories, credentials, cookies, tokens, internal company code, sensitive logs, production data, or non-public context;
- production incidents where local logs, runtime state, and official docs have not been checked first.

### How it works

Default research path:

1. Frame the local problem: goal, symptom, error text, versions, runtime, constraints, and attempted fixes.
2. Choose the evidence surface: issues, PRs, releases, and code for errors; repository candidates for reusable capabilities; both for implementation blockers.
3. Decide whether subagents are useful. Use them only when the task spans independent ecosystems, query families, or evidence surfaces; otherwise state why they were skipped.
4. Search public GitHub with `gh` and targeted queries: exact errors, package names, API names, versions, config keys, frameworks, and failing commands.
5. Rank by problem fit, evidence strength, local applicability, actionability, and project maturity.
6. Deep-read the strongest candidates and extract reusable interfaces, configuration, tests, workflows, risks, and license boundaries.
7. Merge, deduplicate, and reject weak candidates; when subagents were used, the controller directly verifies the strongest claims.
8. Produce a local fix or implementation recommendation with a concrete verification command, request, test, log, or manual check.

### Installation

Install into the default Codex skills directory:

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/Jia-Ethan/pavedpath-code.git \
  ~/.codex/skills/pavedpath-code
```

Update an existing installation:

```bash
git -C ~/.codex/skills/pavedpath-code pull --ff-only
```

Install and authenticate GitHub CLI when needed:

```bash
gh auth status
```

### Usage examples

Invoke the skill in Codex:

```text
Use $pavedpath-code to investigate this Vite build error.
Find matching GitHub issues, merged PRs, release notes, and reusable fixes,
then recommend the smallest local adaptation and verification command.
```

Search repository candidates:

```bash
gh search repos "browser automation agent" \
  --archived=false \
  --sort stars \
  --order desc \
  --limit 10 \
  --json fullName,url,description,stargazersCount,forksCount,language,license,pushedAt,isArchived,openIssuesCount
```

Search matching issues in one repository:

```bash
gh search issues '"Cannot find module" "Node.js 22"' \
  --repo owner/repo \
  --sort updated \
  --order desc \
  --limit 10 \
  --json title,url,state,updatedAt,commentsCount,repository,body
```

Inspect repository basics:

```bash
gh repo view owner/repo \
  --json nameWithOwner,url,description,stargazerCount,forkCount,licenseInfo,primaryLanguage,pushedAt,repositoryTopics,homepageUrl
```

### Output contract

When PavedPath Code materially affects an answer, the answer should include:

- Local problem profile: goal, symptom, versions, environment, and constraints.
- Search path: queries, GitHub/open-source surfaces, discovery methods used, and whether subagents were used or skipped.
- Subagent trace: only when subagents were used; include scope, evidence surfaces, key findings, rejected candidates, deduplication results, and controller verified claims.
- Repository candidates: repo, Stars, forks, language, license, activity, basic content, fit rationale, and adaptation cost.
- Key evidence: links to issues, PRs, code, examples, release notes, or docs, with match rationale.
- Recommended solution: what to reuse directly, what to adapt locally, and what to avoid copying.
- Rejected or risky options: stale versions, mismatches, license, privacy, security, or deployment risks.
- Verification standard: test, build, reproduction command, real request, log, or manual check.
- Confidence label when evidence is weak or no strong open-source solution was found.

### Security

- Research public GitHub content by default. Private repositories require explicit user authorization and a bounded scope.
- Do not write GitHub tokens, cookies, passwords, API keys, private repository contents, internal context, sensitive logs, production data, or credentials into prompts, outputs, logs, README files, scripts, or memory files.
- Do not pass tokens, cookies, private repository contents, sensitive logs, secrets, production data, or credentials to subagents.
- Only check `gh auth status` after a `gh` command reports 403, 429, a private repository authorization error, or an explicit not-authenticated message.
- Avoid copying large chunks of third-party code. Prefer public APIs, configuration shapes, workflows, test patterns, and architecture ideas; check license and attribution obligations before reusing code.
- For security, payments, auth, infrastructure, or production operations, cross-check GitHub evidence against current official docs or official repositories.

## Migration

`github-solution-research` has been renamed to **PavedPath Code**.

Previous behavior is preserved; this is a naming and positioning update. New installations should use:

```bash
git clone https://github.com/Jia-Ethan/pavedpath-code.git \
  ~/.codex/skills/pavedpath-code
```

Do not keep an old `github-solution-research/SKILL.md` under an active Codex skill root together with `pavedpath-code/SKILL.md`; Codex may recursively load both.

## License

MIT License. See [LICENSE](LICENSE).
