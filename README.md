# paseo-recap

A [Paseo](https://github.com/getpaseo/paseo) plugin that shows a short "where things stand" recap
for every agent — goal, current state, next action — pinned outside the conversation timeline.
Provider-agnostic: works with Claude, Codex, OMP, Pi, OpenCode, and custom providers.

Status: design phase. See [docs/design.md](docs/design.md) for the design and a comparison with
Claude Code, Codex, OMP, and other agent products.

> Paseo plugins are trusted, unsandboxed code that runs on the daemon host. Recaps send recent
> conversation text to the model provider configured for Paseo metadata generation.

## Development

```bash
npm install
npm run typecheck
paseo plugin install "$PWD"
```
