# llm-vitals

Live tokens per second for Claude Code and Codex, in your terminal and in Claude Code's status line. llm-vitals reads the session logs both tools write locally, so it works with subscription logins and API keys alike, and sends nothing over the network.

## Install

```sh
npm install -g llm-vitals
```

With Homebrew on macOS or Linux:

```sh
brew install tecyfyai/tap/llm-vitals
```

Or run it once with `npx llm-vitals`. Requires Node.js 20 or later (Homebrew installs it for you).

## Watch every session live

```sh
llm-vitals
```

```text
TOOL         PROJECT   MODEL              NOW    AVERAGE  CALLS  OUTPUT  CACHE      CONTEXT
Claude Code  web-app   claude-opus-5-5   ● 4s  102 tok/s     25   47.5k    95%       125.0k
Codex        api       gpt-6.1-sol   25 tok/s   37 tok/s     75   54.2k    98%  229.8k 48%
```

**NOW** is the speed of the latest reply, or `●` and the time waited when a request is in progress. **AVERAGE** covers every timed call in the session. **CACHE** is the share of input tokens read from the prompt cache.

| Option               | Effect                                                     |
| -------------------- | ---------------------------------------------------------- |
| `--once`             | Print the table once and exit                              |
| `--json`             | Print sessions and their stats as JSON                     |
| `--window <minutes>` | Include sessions active in the last N minutes (default 60) |
| `--interval <ms>`    | Refresh rate of the live view (default 1000)               |
| `setup [--undo]`     | Add llm-vitals to Claude Code's status line, or remove it  |

## Show speed in Claude Code's status line

```sh
npx llm-vitals setup
```

Claude Code's status line then reads `⚡ 62 tok/s · avg 55 tok/s · ctx 41%`, and `⏳ 4s` while a request is in progress. `ctx` is the share of the context window in use, as Claude Code reports it. Run `npx llm-vitals setup --undo` to remove it.

Setup installs a small self-contained script in Claude Code's config folder and points the `statusLine` setting at it, so the status line keeps working after npm caches are cleared. It changes nothing else in `settings.json`, backs up the original, and leaves an existing status line alone: if you already have one, it tells you and stops.

To keep the waiting timer ticking between updates, add `"refreshInterval": 1` to the `statusLine` entry. This is optional, and the status line runs once a second while it is set.

## Use it as a library

```ts
import { Tracker, summarize } from "llm-vitals";

const tracker = new Tracker();
for (const session of await tracker.poll()) {
  console.log(session.source, session.model, summarize(session).averageRate);
}
```

`Tracker` finds active session files and reads only the lines added since the last `poll()`. `claudeParser` and `codexParser` parse a single file, and `summarize` turns a session into speed, cache and context figures.

## How speed is measured

Output tokens divided by the time from request sent to reply logged. That includes time to first token, so it is end-to-end speed, slightly below raw generation speed. Claude Code calls are timed from their logged request time. Codex calls are timed from the input that started them, such as your message or a tool result.

See [SECURITY.md](https://github.com/tecyfyai/llm-vitals/blob/main/SECURITY.md) for exactly what llm-vitals reads and writes.

llm-vitals is not affiliated with Anthropic or OpenAI. The log formats it reads are internal to each tool and may change.
