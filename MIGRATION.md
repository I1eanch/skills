# Migration: PavedPath Code

`github-solution-research` has been renamed to **PavedPath Code**.

- New skill name: `pavedpath-code`
- Display name: `PavedPath Code`
- Chinese alias: `PavedPath Code（代码版）`
- Previous behavior is preserved; this is a naming and positioning update.
- New active installations should use the `pavedpath-code` Skill name. If your runtime uses `~/.codex/skills`, install to `~/.codex/skills/pavedpath-code`; other agent runtimes should use their own active skill/instruction directory.
- Avoid keeping an old `github-solution-research/SKILL.md` under an active skill root, because an agent runtime may recursively load both names.

## Update an existing local installation

```bash
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/pavedpath-code
git clone https://github.com/Jia-Ethan/pavedpath-code.git ~/.codex/skills/pavedpath-code
```

If an old installation exists at `~/.codex/skills/github-solution-research`, move it outside the active skill root or remove it after confirming `pavedpath-code` is installed.
