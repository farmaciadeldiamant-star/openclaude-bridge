# openclaude-bridge

**OpenAI-compatible HTTP bridge for the local Claude Code CLI.**

Lets any OpenAI-client app (Odoo, n8n, LangChain, OpenWebUI, your own scripts…) talk to Claude through a **Claude Code subscription** — no separate Anthropic API key required.

It exposes a tiny Node.js HTTP server that speaks the OpenAI `chat/completions` protocol and, under the hood, shells out to `claude --print` (the headless mode of the [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) CLI).

---

## Why

If you already pay for a Claude Max / Pro subscription through Claude Code, you can reuse that same auth to power automations and integrations that otherwise expect an `OPENAI_API_KEY` + a base URL. Common use cases:

- Plug Claude into an **Odoo** LLM module (e.g. `apexive/odoo-llm`) as an "OpenAI" provider.
- Point **n8n**, **LangChain**, **OpenWebUI**, or **LibreChat** at Claude.
- Write scripts with the official `openai` Python/JS SDK against Claude without juggling two keys.

---

## How it works

```
┌──────────────────┐   HTTP (OpenAI API)   ┌──────────────────┐   stdin/stdout   ┌──────────────────┐
│  Your app        │ ───────────────────▶  │ openclaude-bridge│ ───────────────▶ │  claude --print  │
│  (Odoo, n8n, …)  │ ◀───────────────────  │  (Node.js)       │ ◀─────────────── │  (Claude Code)   │
└──────────────────┘                       └──────────────────┘                  └──────────────────┘
```

The bridge:

1. Accepts `POST /v1/chat/completions` payloads.
2. Extracts the last user message.
3. Spawns `claude --print --permission-mode bypassPermissions --model <id>` (optionally with `--continue` for a sticky workspace session).
4. Pipes the user text in via `stdin`, reads the plain-text answer from `stdout`.
5. Wraps the output in a valid OpenAI completion (or SSE stream) and returns it.

Concurrent requests are serialized — the Claude Code CLI is heavy and a single workspace cannot safely run overlapping turns.

---

## Prerequisites

- **Node.js ≥ 18**
- **[Claude Code CLI](https://docs.claude.com/en/docs/claude-code/setup)** installed and logged in with your subscription. Verify with:
  ```bash
  claude --version
  claude --print "say hi"
  ```
- A working Claude subscription (Max / Pro / Team).

The bridge auto-detects the CLI via `npm root -g` or falls back to `claude` on your `PATH`. You can override with the `CLAUDE_CLI` env var.

---

## Install

### Option A — clone and run

```bash
git clone https://github.com/farmaciadeldiamant-star/openclaude-bridge.git
cd openclaude-bridge
node bridge.mjs
```

### Option B — global install (once published to npm)

```bash
npm install -g openclaude-bridge
openclaude-bridge
```

### Option C — npx (one-shot)

```bash
npx openclaude-bridge
```

---

## Configuration

All options are environment variables. Copy `.env.example` to `.env` and adjust, or export them in your shell / service manager.

| Variable | Default | Description |
|---|---|---|
| `OPENCLAUDE_PORT` | `8788` | HTTP port |
| `OPENCLAUDE_HOST` | `127.0.0.1` | Bind host. Set `0.0.0.0` to expose on LAN. |
| `OPENCLAUDE_MODEL` | `claude-opus-4-6` | Model ID advertised on `/v1/models` and passed to `claude --model` |
| `OPENCLAUDE_CONTINUE` | `0` | `1` → pass `--continue` (sticky workspace session, preserves memory between turns). `0` → fresh session per request. |
| `OPENCLAUDE_CWD` | `os.tmpdir()/openclaude-bridge-cwd` | Working dir for `claude --print`. Use a dedicated folder if you want a persistent `CLAUDE.md` / skills / memory for the bridge's own context. |
| `OPENCLAUDE_TIMEOUT_MS` | `180000` | Per-turn timeout in ms (3 min) |
| `OPENCLAUDE_PERMS` | `bypassPermissions` | Permission mode passed to `claude --permission-mode` |
| `CLAUDE_CLI` | auto-detect | Explicit path to `cli.js` of `@anthropic-ai/claude-code` |
| `NODE_BIN` | `process.argv[0]` | Node binary used to invoke the CLI |

### Sticky vs. stateless

- **Stateless** (`OPENCLAUDE_CONTINUE=0`, default): every request is an independent Claude Code invocation. Safe for multi-tenant or concurrent callers. No memory between turns.
- **Sticky** (`OPENCLAUDE_CONTINUE=1`): reuses the workspace session via `--continue`. Claude remembers prior turns, loads `CLAUDE.md` and skills from `OPENCLAUDE_CWD`. Good for a single-user assistant, **bad** if multiple apps share the same bridge.

---

## Endpoints

### `GET /health`
```json
{"ok": true, "cwd": "...", "model": "claude-opus-4-6", "port": 8788, "stateless": true, "cli": "..."}
```

### `GET /v1/models`
```json
{"object": "list", "data": [{"id": "claude-opus-4-6", "object": "model", "owned_by": "openclaude-bridge", "created": 0}]}
```

### `POST /v1/chat/completions`
Standard OpenAI chat completion request. Supports `stream: true` (SSE). Only the **last user message** is forwarded to Claude — system messages and assistant history are not replayed (Claude Code's own memory handles that if sticky mode is enabled).

---

## Quick test

```bash
# health
curl http://127.0.0.1:8788/health

# chat (non-streaming)
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"What is 7*8?"}]}'
```

See [`examples/`](./examples) for more (Python OpenAI SDK, Odoo integration, n8n).

---

## Limitations

- **One turn at a time.** Concurrent requests queue up; this is a local bridge, not a scaling service.
- **Last-message-only.** Chat history from the OpenAI payload is not re-sent (use sticky mode if you need continuity).
- **No tool-calling.** The bridge returns plain text. Claude Code may internally use its own tools, but the `tools` field in the OpenAI payload is ignored.
- **Plain text output.** Token counts in `usage` are zeroed out — Claude Code doesn't expose them via `--print`.
- **Latency.** Spawning the CLI adds ~1–3s per turn vs. a direct API call.

---

## Legal / ToS

This project uses the official, supported `--print` mode of the Claude Code CLI. It does **not** reverse-engineer, scrape, or otherwise circumvent any Anthropic service.

That said, **you** are responsible for complying with the [Anthropic Usage Policies](https://www.anthropic.com/legal/aup) and your Claude subscription terms. In particular, using your personal subscription to serve third parties or as a commercial API may violate those terms. Use at your own risk.

---

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

Issues and PRs welcome. Keep the bridge small: no feature creep that duplicates what Claude Code itself already does.
