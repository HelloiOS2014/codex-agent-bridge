# Claude Companion Codex Plugin

Claude Companion lets Codex delegate planning, code review, adversarial review, and explicitly write-enabled rescue tasks to local Claude Code.

Planned command surface for later runtime tasks:

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

The CLI runtime is not implemented in this scaffold yet. When implemented, `plan`, `review`, and `adversarial-review` are read-only. `rescue` can edit files only when `--write` is present.
