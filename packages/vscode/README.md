# llm-vitals: tokens per second, cache and context for Claude Code and Codex

See how fast Claude Code and Codex are generating, right in the status bar. llm-vitals shows the tokens per second of your most recent session, and the time waited while a request is in progress. It reads the session logs both tools write on your machine, so it needs no API key and sends nothing anywhere.

Works in VS Code, Cursor, Antigravity and other editors built on VS Code.

## What you see

- **Status bar:** a pulse icon and `62 tok/s` after each reply, or a spinner with the seconds waited while a request runs.
- **Hover:** latest and average speed and cache hit rate for each active session.
- **Click**, or run **LLM Vitals: Show Active Sessions**: per-session calls, output tokens, cache hit rate, context size (tokens in the conversation, with the share of the window for Codex) and Codex rate limits.

## Show speed in Claude Code's terminal too

If you use Claude Code, llm-vitals asks once whether to add tokens per second to Claude Code's own status line, under the prompt in your terminal. Choose **Enable**, or run **LLM Vitals: Enable in Claude Code Status Line** from the Command Palette at any time. **LLM Vitals: Disable in Claude Code Status Line** removes it.

This needs Node.js 20 or later on your `PATH`. It changes only the `statusLine` entry in Claude Code's `settings.json`, keeps a backup, and never replaces a status line you already have.

## Settings

| Setting                         | Default | Meaning                                    |
| ------------------------------- | ------- | ------------------------------------------ |
| `llmVitals.refreshIntervalMs`   | `1000`  | How often new log lines are read           |
| `llmVitals.activeWindowMinutes` | `60`    | Show sessions active in the last N minutes |

Both are read from your user settings only, so a folder you open can't change them.

## How is speed measured?

Output tokens divided by the time from request sent to reply logged. This includes time to first token, so it is end-to-end speed. Numbers update after each model call, so agent tasks update every few seconds.

For a terminal view, see the [`llm-vitals` CLI](https://www.npmjs.com/package/llm-vitals).

llm-vitals is not affiliated with Anthropic or OpenAI.
