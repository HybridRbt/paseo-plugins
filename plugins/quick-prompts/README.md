# paseo-quick-prompts

**Saved prompts as one-tap pills above every agent's composer in [Paseo](https://github.com/getpaseo/paseo).**

Save the messages you send often, like "Review the uncommitted changes" or "Run the tests and fix
failures". Each one becomes a pill above every agent's composer; tapping it sends the prompt to that
agent as a normal user message.

## Features

- **One pill per prompt** on every agent with a workspace, in the order you set, or **one menu
  pill** (Prompts) that lists them all with a **Manage prompts** shortcut.
- **Settings screen** under **Settings → Plugins → paseo-quick-prompts → Quick prompts** to add, edit, reorder, and delete
  prompts and choose how they appear. Changes save automatically.
- **Prompt ideas.** A copyable prompt on the settings screen asks an agent to read your Paseo agent
  history and suggest the quick prompts you would use most.
- **Shared per host.** Prompts are stored on the daemon and every connected app sees the same list;
  pills update live when it changes.
- **Empty state.** With no prompts saved, each agent shows an **Add quick prompt** pill that opens
  the settings screen.

## Requirements

- Paseo **0.11.0** or later, with plugins enabled (**Settings → Plugins → Enable plugins**, or
  `"pluginsEnabled": true` in `~/.paseo/config.json`)

## Install

```bash
paseo plugin install npm:paseo-quick-prompts
```

You can also paste `npm:paseo-quick-prompts` into **Settings → Plugins → Plugin source**, or install
the latest source with `paseo plugin install github:kingsleydon/paseo-plugins:plugins/quick-prompts`.

## Settings

| Field | Limit | Description |
|---|---|---|
| Label | 1–40 characters | Text on the pill |
| Prompt | 1–10,000 characters | Message sent to the agent |

Up to 20 prompts. Leading and trailing whitespace is trimmed when you save.

Delete, **Move up**/**Move down**, and **Show prompts as** save right away. An edited label or
prompt saves when the field loses focus, if it is valid; an invalid value shows an error on the
field and is not saved. New prompts are entered in their own form and saved with **Add quick
prompt**. If another app saved in the meantime, the change is applied to the latest prompts and
saved again; when it no longer applies (for example, the prompt was deleted), a toast says so and
the latest prompts are shown.

**Show prompts as** is **Separate pills** (default) or **One menu pill**. Settings saved before this
option existed keep separate pills.

## How it works

- The settings document (`prompts`, host scope) is registered by the daemon entry and stored by Paseo.
- The app entry follows the agent directory with an owned list subscription and re-reads the prompts
  whenever any client saves them, then keeps one composer pill per prompt (or one menu pill) on each
  non-archived agent that has a workspace. Prompt changes update existing pills in place; a reorder
  of separate pills or a display switch re-registers that agent's pills.
- A pill press or menu choice calls `paseo.agents.ref(agentId).send(text)`. Paseo shows the pill as busy until the
  send settles and reports failures in a toast.

Not supported: pills in the new-agent composer, inserting text into the composer for editing, and
import or export.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload paseo-quick-prompts   # after changes
paseo plugin logs paseo-quick-prompts
```

| Path | Contents |
|---|---|
| `index.server.ts` | Daemon entry: registers the settings document |
| `index.client.tsx` | App entry: settings screen and composer pills |
| `client/pills.ts` | Keeps each agent's pills in sync with the saved prompts |
| `client/follow.ts` | Follows the agent directory and settings changes |
| `client/settings-screen.tsx` | Autosaving editor for the prompts and display option, and the prompt-ideas tip |
| `client/edits.ts` | Prompt edits and the save that retries once after a conflict |
| `shared/prompts.ts` | Settings schema and limits |

## Releasing

Bump `version` in `package.json` in a PR, merge it, then tag the merged commit with
`quick-prompts-v<version>`:

```bash
git tag quick-prompts-v0.1.0 && git push origin quick-prompts-v0.1.0
```

See the [repository README](../../README.md#releasing) for how the publish workflow works.

## License

[MIT](LICENSE)
