# Skills

One directory holding every agent skill for this repo.

Coding agents each look for skills in their own tool-specific path, so those paths are symlinks
pointing here:

| Path             | Target            |
| ---------------- | ----------------- |
| `.claude/skills` | `.agents/skills`  |
| `.cursor/skills` | `.agents/skills`  |

Claude Code, Cursor, opencode, and anything else that reads `.agents/skills` directly all end up
with the same set. Add a skill once, in this directory, and every agent picks it up. Adding support
for another tool means adding another symlink, not another copy.
