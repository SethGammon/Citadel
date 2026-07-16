# Hook Manifests

`hooks-template.json` is the source manifest for Claude Code. Citadel resolves its `${CLAUDE_PLUGIN_ROOT}` placeholders and installs the resulting commands into each project's `.claude/settings.json`.

Do not add `hooks/hooks.json`. Claude Code auto-discovers that conventional plugin path, which would duplicate the resolved project hooks.

Codex plugin hooks are generated separately at `runtimes/codex/hooks.json` and referenced explicitly from `.codex-plugin/plugin.json`.
