# Migration: PavedPath Code

`github-solution-research` has been renamed to **PavedPath Code**.

- New skill name: `pavedpath-code`
- Display name: `PavedPath Code`
- Chinese alias: `PavedPath Code（代码版）`
- Previous behavior is preserved; this is a naming and positioning update.
- New active Codex skill installations should live at `~/.codex/skills/pavedpath-code`.
- Avoid keeping an old `github-solution-research/SKILL.md` under an active skill root, because Codex may recursively load both names.

## Update an existing local installation

```bash
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/pavedpath-code
git clone https://github.com/Jia-Ethan/pavedpath-code.git ~/.codex/skills/pavedpath-code
```

If an old installation exists at `~/.codex/skills/github-solution-research`, move it outside the active skill root or remove it after confirming `pavedpath-code` is installed.
