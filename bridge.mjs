#!/usr/bin/env node
/**
 * openclaude-bridge
 * ------------------
 * Exposes an OpenAI-compatible HTTP endpoint that relays chat completions to
 * the local `claude` Code CLI. Lets any OpenAI-client app (Odoo, n8n, LangChain,
 * OpenWebUI, your own scripts…) talk to Claude through a Claude Code
 * subscription, without needing a separate Anthropic API key.
 *
 * Endpoints:
 *   GET  /health                — quick status probe
 *   GET  /v1/models             — list exposed model IDs
 *   POST /v1/chat/completions   — OpenAI-compatible chat completions
 *
 * Environment variables (all optional):
 *   OPENCLAUDE_PORT        HTTP port (default 8788)
 *   OPENCLAUDE_HOST        Bind host (default 127.0.0.1; set 0.0.0.0 to expose)
 *   OPENCLAUDE_CWD         Working dir for `claude --print` (default: a temp dir)
 *   OPENCLAUDE_MODEL       Model ID to advertise (default claude-opus-4-6)
 *   OPENCLAUDE_CONTINUE    "1" to pass --continue (sticky workspace session);
 *                          unset/0 for stateless (each request is fresh)
 *   OPENCLAUDE_TIMEOUT_MS  Per-turn timeout (default 180000 = 3 min)
 *   OPENCLAUDE_PERMS       Permission mode (default bypassPermissions)
 *   CLAUDE_CLI             Explicit path to the claude-code CLI (auto-detected
 *                          via `npm root -g` or PATH fallback)
 *   NODE_BIN               Node executable (defaults to process.argv[0])
 *
 * License: MIT
 */

import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------- configuration ----------------------

const PORT = Number(process.env.OPENCLAUDE_PORT || 8788);
const HOST = process.env.OPENCLAUDE_HOST || '127.0.0.1';
const MODEL_ID = process.env.OPENCLAUDE_MODEL || 'claude-opus-4-6';
const USE_CONTINUE = process.env.OPENCLAUDE_CONTINUE === '1';
const TIMEOUT_MS = Number(process.env.OPENCLAUDE_TIMEOUT_MS || 180000);
const PERMS = process.env.OPENCLAUDE_PERMS || 'bypassPermissions';
const NODE_BIN = process.env.NODE_BIN || process.argv[0];

const CWD = (() => {
  if (process.env.OPENCLAUDE_CWD) return process.env.OPENCLAUDE_CWD;
  const dir = path.join(os.tmpdir(), 'openclaude-bridge-cwd');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
})();

const LOG_PATH = path.join(__dirname, 'bridge.log');

// ---------------------- CLI auto-detection ----------------------

function detectClaudeCli() {
  if (process.env.CLAUDE_CLI && existsSync(process.env.CLAUDE_CLI)) {
    return process.env.CLAUDE_CLI;
  }
  // Try `npm root -g`
  try {
    const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['root', '-g'], { encoding: 'utf-8', windowsHide: true });
    if (r.status === 0) {
      const globalRoot = r.stdout.trim();
      const candidate = path.join(globalRoot, '@anthropic-ai', 'claude-code', 'cli.js');
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* ignore */ }
  // Fallback: assume `claude` is on PATH (we'll invoke it via shell)
  return null;
}

const CLAUDE_CLI = detectClaudeCli();

// ---------------------- logging ----------------------

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
  console.log(line);
  try { appendFileSync(LOG_PATH, line + '\n'); } catch { /* ignore */ }
}

// ---------------------- claude spawner ----------------------

let busy = Promise.resolve();

function runClaude(userText) {
  return new Promise((resolve, reject) => {
    const baseArgs = [
      '--print',
      '--permission-mode', PERMS,
      '--model', MODEL_ID,
    ];
    if (USE_CONTINUE) baseArgs.push('--continue');

    let bin, args;
    if (CLAUDE_CLI) {
      bin = NODE_BIN;
      args = [CLAUDE_CLI, ...baseArgs];
    } else {
      // Fallback: assume `claude` CLI binary is on PATH
      bin = process.platform === 'win32' ? 'claude.cmd' : 'claude';
      args = baseArgs;
    }

    log('spawn', { cwd: CWD, stateless: !USE_CONTINUE, preview: userText.slice(0, 120) });
    const child = spawn(bin, args, {
      cwd: CWD,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      child.stdin.write(userText);
      child.stdin.end();
    } catch (e) {
      log('stdin write failed', { error: String(e?.message || e) });
    }

    let out = '', err = '';
    const timer = setTimeout(() => {
      log('timeout, killing claude');
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
      reject(new Error(`claude timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        log('claude failed', { code, stderr: err.slice(-600) });
        return reject(new Error(`claude exited ${code}: ${err.slice(-500) || 'no stderr'}`));
      }
      const cleaned = out
        .replace(/\r\nShell cwd was reset to .*$/m, '')
        .replace(/\nShell cwd was reset to .*$/m, '')
        .trim();
      resolve(cleaned);
    });
  });
}

// ---------------------- HTTP helpers ----------------------

function extractLastUserText(payload) {
  const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
  const lastUser = [...msgs].reverse().find(m => m?.role === 'user');
  if (!lastUser) return '';
  if (typeof lastUser.content === 'string') return lastUser.content;
  if (Array.isArray(lastUser.content)) {
    return lastUser.content
      .filter(p => p?.type === 'text' || typeof p?.text === 'string')
      .map(p => p.text)
      .join('\n');
  }
  return '';
}

function okJson(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function errJson(res, code, message) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type: 'bridge_error' } }));
}

function sseEvent(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// ---------------------- HTTP server ----------------------

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return okJson(res, {
      ok: true, cwd: CWD, model: MODEL_ID, port: PORT,
      stateless: !USE_CONTINUE, cli: CLAUDE_CLI || '(PATH claude)',
    });
  }
  if (req.method === 'GET' && req.url === '/v1/models') {
    return okJson(res, {
      object: 'list',
      data: [{ id: MODEL_ID, object: 'model', owned_by: 'openclaude-bridge', created: 0 }],
    });
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
    return errJson(res, 404, `not found: ${req.method} ${req.url}`);
  }

  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(raw || '{}'); }
    catch (e) { return errJson(res, 400, `invalid JSON: ${e.message}`); }

    const text = extractLastUserText(payload);
    if (!text) return errJson(res, 400, 'no user message found');

    const wantStream = payload.stream === true;
    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    // Serialize concurrent requests — claude CLI is heavy and single-session CWD
    // cannot reliably handle concurrent --continue invocations.
    const prev = busy;
    let release;
    busy = new Promise(r => { release = r; });
    try {
      await prev;
      log('turn start', { id, chars: text.length, stream: wantStream });
      const answer = await runClaude(text);
      log('turn done', { id, outChars: answer.length });

      if (wantStream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        });
        sseEvent(res, { id, object: 'chat.completion.chunk', created, model: MODEL_ID,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
        sseEvent(res, { id, object: 'chat.completion.chunk', created, model: MODEL_ID,
          choices: [{ index: 0, delta: { content: answer }, finish_reason: null }] });
        sseEvent(res, { id, object: 'chat.completion.chunk', created, model: MODEL_ID,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        okJson(res, {
          id, object: 'chat.completion', created, model: MODEL_ID,
          choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    } catch (e) {
      log('turn failed', { id, error: String(e?.message || e) });
      if (!res.headersSent) errJson(res, 500, String(e?.message || e));
      else try { res.end(); } catch { /* ignore */ }
    } finally {
      release();
    }
  });
});

server.listen(PORT, HOST, () => {
  log(`openclaude-bridge listening http://${HOST}:${PORT}`);
  log(`  cwd=${CWD}`);
  log(`  model=${MODEL_ID}`);
  log(`  stateless=${!USE_CONTINUE}`);
  log(`  cli=${CLAUDE_CLI || '(PATH claude)'}`);
  log(`  timeout=${TIMEOUT_MS}ms`);
});

process.on('SIGINT', () => { log('SIGINT, exit'); process.exit(0); });
process.on('SIGTERM', () => { log('SIGTERM, exit'); process.exit(0); });
