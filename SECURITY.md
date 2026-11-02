# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue. You can expect a first reply within a week.

## What llm-vitals touches

llm-vitals is designed to have as little reach as possible:

- **No network access.** It reads local log files and never sends data anywhere.
- **No runtime dependencies.** The npm package and the extension ship only their own code.
- **Read-only by default.** Logs are only read. The one write is the opt-in Claude Code status line setup (`llm-vitals setup`, or **Enable** in the editor), which:
  - changes only the `statusLine` key of Claude Code's `settings.json`, and never replaces a status line llm-vitals did not write;
  - refuses to touch a settings file that is not valid JSON;
  - writes atomically, keeps the file's permissions and saves a backup of the original as `settings.json.llm-vitals-backup`;
  - installs one script, `llm-vitals/statusline.cjs`, in Claude Code's config folder, and builds the command with quoted paths, refusing any path that a shell could expand.
- **Untrusted text is neutralised.** Folder and model names read from logs are stripped of control characters before they reach a terminal, and escaped before they reach Markdown.
