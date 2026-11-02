# llm-vitals: tokens per second, cache and context for Claude Code and Codex

llm-vitals shows how fast your AI coding agent is generating, in tokens per second, while you work. It also shows cache hit rate, context size and rate limits for every active Claude Code and Codex session. It reads the session logs both tools already write on your machine, so it needs no API key and sends nothing anywhere.

```text
TOOL         PROJECT   MODEL              NOW    AVERAGE  CALLS  OUTPUT  CACHE      CONTEXT
Claude Code  web-app   claude-opus-5-5   ● 4s  102 tok/s     25   47.5k    95%       125.0k
Codex        api       gpt-6.1-sol   25 tok/s   37 tok/s     75   54.2k    98%  229.8k 48%
```

It comes in two parts:

| Package                                   | Where it runs                                                              | Install                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`llm-vitals`](packages/llm-vitals)       | Terminal, Claude Code status line, Node.js library                         | `npm install -g llm-vitals` or `brew install tecyfyai/tap/llm-vitals` |
| [llm-vitals for VS Code](packages/vscode) | Status bar in VS Code, Cursor, Antigravity and other VS Code based editors | VS Code Marketplace or Open VSX                                       |

## How do I start?

Install the editor extension and you are done: the status bar shows tokens per second as soon as Claude Code or Codex replies. There is nothing to configure.

In a terminal, `npx llm-vitals` opens the live view with no install. To see speed inside Claude Code's own status line, run `npx llm-vitals setup` once, or click **Enable** when the extension asks.

## How is tokens per second measured?

Speed is a reply's output tokens divided by the time from the request being sent to the reply being logged. That time includes the wait before the first token, so these are end-to-end numbers, a little lower than the model's raw generation speed.

- **Claude Code** logs when each request is sent and when each part of the reply arrives, so every call is timed directly.
- **Codex** logs usage when each response finishes. A response is timed from the input that started it: your message or a tool result.

Numbers update after each model call, and an agent task makes many calls. A request in progress shows how long it has been waiting.

## Which tools are supported?

| Tool              | Logs read                                       | Status    |
| ----------------- | ----------------------------------------------- | --------- |
| Claude Code       | `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR`) | Supported |
| Codex CLI and app | `~/.codex/sessions/` (or `$CODEX_HOME`)         | Supported |
| Antigravity       | `~/.gemini/antigravity/`                        | Planned   |

## FAQ

### Does llm-vitals send my code or prompts anywhere?

No. It only reads log files on your own disk and makes no network requests.

### Does llm-vitals change my Claude Code settings?

Only when you ask it to. `llm-vitals setup` and the extension's **Enable** button change the `statusLine` entry and nothing else, back up the original file, and never replace a status line you already have. [SECURITY.md](SECURITY.md) lists everything llm-vitals reads and writes.

### What does the context number mean?

How many tokens the conversation takes up: everything the model read for its latest reply, plus what it wrote. Codex logs its context window, so Codex sessions also show the share of the window used, such as `229.8k 48%`. Claude Code's logs don't record the window size, so its sessions show the token count only. Claude Code's own status line is the exception: there, `ctx 12%` is the share Claude Code itself reports.

### Why doesn't Codex show llm-vitals inside its terminal?

Codex's status line only accepts its own built-in items, so llm-vitals shows Codex sessions in the `llm-vitals` terminal view and in the editor extension.

### Is it an official Anthropic or OpenAI tool?

No. llm-vitals is an independent open source project. The log formats it reads are not public APIs and can change between releases.

## Development

```sh
npm install
npm run check   # lint, build, typecheck, test
```

Requires Node.js 20 or later. MIT licensed. Report security issues as described in [SECURITY.md](SECURITY.md).
