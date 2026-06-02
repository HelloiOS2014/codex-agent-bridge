# Claude Companion Codex Plugin

Claude Companion lets Codex delegate planning, code review, adversarial review, and explicitly write-enabled rescue tasks to local Claude Code.

Command surface:

```bash
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs plan "plan this change"
node scripts/claude-companion.mjs review --scope working-tree
node scripts/claude-companion.mjs adversarial-review "challenge this caching design"
node scripts/claude-companion.mjs rescue --write "fix the failing test"
node scripts/claude-companion.mjs status
node scripts/claude-companion.mjs result
node scripts/claude-companion.mjs cancel <job-id>
```

`plan`, `review`, and `adversarial-review` are read-only. `rescue` can edit files only when `--write` is present.

Codex skill guidance lives in [`skills/`](skills/): `claude-plan`, `claude-review`, `claude-rescue`, and `claude-result-handling`.
