# Using openclaude-bridge with n8n

n8n's **OpenAI** and **AI Agent** nodes accept a custom base URL via the OpenAI credential. Pointing them at the bridge is enough.

## 1. Start the bridge on a host n8n can reach

If n8n runs in Docker, `127.0.0.1` inside the container is NOT your host. Use one of:

- Run the bridge with `OPENCLAUDE_HOST=0.0.0.0` and use `http://host.docker.internal:8788/v1` from n8n.
- Deploy the bridge on the same Docker network as n8n and reference it by service name.

## 2. Create the OpenAI credential in n8n

**Credentials → New → OpenAI API**

| Field | Value |
|---|---|
| API Key | `not-needed` |
| Base URL | `http://host.docker.internal:8788/v1` (or wherever the bridge listens) |

## 3. Use it in an OpenAI node

| Field | Value |
|---|---|
| Resource | `Chat` |
| Operation | `Message a model` |
| Model | `claude-opus-4-6` (type it manually if the dropdown is empty — n8n caches the model list) |
| Messages | whatever you want to send |

Response arrives in the normal OpenAI shape: `choices[0].message.content`.

## Caveats

- **`tools` / function-calling is not supported.** If your n8n workflow relies on the AI Agent node's tool use, the bridge won't forward tool calls — it returns plain text.
- **Token usage is zero.** n8n's usage/cost metrics will all report 0.
- **Single-flight.** Concurrent runs will queue in the bridge. For heavy workflows, run multiple bridges on different ports or keep concurrency ≤ 1 in the node.
