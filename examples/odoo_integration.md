# Using openclaude-bridge with Odoo

[apexive/odoo-llm](https://github.com/apexive/odoo-llm) is an Odoo 18 module that adds an LLM layer to any Odoo database. It talks to OpenAI-compatible endpoints out of the box — which means `openclaude-bridge` plugs in as a drop-in "OpenAI" provider backed by your Claude subscription.

## 1. Start the bridge

On the same machine as Odoo (or on a LAN host):

```bash
# stateless (recommended for a shared Odoo server)
OPENCLAUDE_PORT=8788 OPENCLAUDE_HOST=127.0.0.1 node bridge.mjs
```

Check it's up:

```bash
curl http://127.0.0.1:8788/health
```

## 2. Install the odoo-llm addons

```bash
cd <your-odoo-custom-addons>
git clone https://github.com/apexive/odoo-llm.git
```

Add the path to `odoo.conf` (note the nested folder — the OCA-style repo contains one module per subfolder):

```ini
addons_path = ...,/path/to/custom_addons,/path/to/custom_addons/odoo-llm
```

Restart Odoo, enable **Developer Mode**, and install these apps:

- `llm` (core)
- `llm_tool`
- `llm_openai` (the provider we'll use for the bridge)

## 3. Create the provider

**Settings → Technical → LLM → Providers → New**

| Field | Value |
|---|---|
| Name | `Claude (via bridge)` |
| Service | `OpenAI` |
| API Base | `http://127.0.0.1:8788/v1` |
| API Key | `not-needed` (bridge ignores it, but the field must be non-empty) |

Save.

## 4. Register the model

Still on the provider form, click **Fetch Models** (it will read `GET /v1/models` from the bridge and create an `llm.model` record for `claude-opus-4-6`).

If the wizard doesn't pick it up, create it manually in **Technical → LLM → Models**:

| Field | Value |
|---|---|
| Name | `Claude Opus 4.6` |
| Technical Name | `claude-opus-4-6` |
| Provider | `Claude (via bridge)` |
| Role | `Chat` |

## 5. Test

**Technical → LLM → Chats → New**, pick the model, and send a message. The bridge log (`bridge.log`) will show the spawn and completion.

## Tips

- **Timeouts**: long Odoo prompts may exceed the default 3-minute cap. Bump `OPENCLAUDE_TIMEOUT_MS=600000` for 10 minutes.
- **Shared workspace**: if you want Claude to have project-specific context (e.g. your Odoo schema notes), set `OPENCLAUDE_CWD=/path/to/folder` and drop a `CLAUDE.md` there.
- **Logs**: `bridge.log` in the install dir records every turn. Useful to debug when Odoo's LLM view just shows "failed".
- **One bridge per caller**: if you also use the bridge from other tools, keep them stateless (`OPENCLAUDE_CONTINUE=0`) — sticky mode will mix their conversations together.
