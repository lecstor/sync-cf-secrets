---
"sync-cf-secrets": minor
---

Replace automatic postinstall skill copy with opt-in `install-skill` and `reveal-skill` commands. The postinstall script that wrote to `~/.claude/skills/` on `npm install` has been removed — run `sync-cf-secrets install-skill` to install the Claude Code skill, or `sync-cf-secrets reveal-skill` to get the path for manual copying.
