import { stat } from "node:fs/promises";
import {
  disableStatusline,
  enableStatusline,
  formatDuration,
  formatPercent,
  formatRate,
  formatTokens,
  modelName,
  nodeCommand,
  projectName,
  refreshStatusline,
  type Session,
  SetupError,
  type Summary,
  sourceName,
  statuslinePaths,
  statuslineState,
  summarize,
  Tracker,
} from "llm-vitals";
import * as vscode from "vscode";

const SECTION = "llmVitals";
/** Set once the user has been asked about Claude Code's status line, so they are asked only once. */
const ASKED_KEY = "llmVitals.statuslineAsked";

export function activate(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem("llmVitals.status", vscode.StatusBarAlignment.Right, 100);
  item.name = "LLM Vitals";
  item.command = "llmVitals.showSessions";

  let tracker = createTracker();
  let sessions: Session[] = [];
  let timer: NodeJS.Timeout | undefined;
  let polling = false;

  const tick = async () => {
    if (polling) return;
    polling = true;
    try {
      sessions = visible(await tracker.poll());
      update(item, sessions);
    } catch {
      // Keep showing the last reading; the next tick tries again.
    } finally {
      polling = false;
    }
  };

  const start = () => {
    clearInterval(timer);
    timer = setInterval(tick, setting("refreshIntervalMs", 1000, 250, 60_000));
    void tick();
  };

  context.subscriptions.push(
    item,
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand("llmVitals.showSessions", () => showSessions(sessions)),
    vscode.commands.registerCommand("llmVitals.enableClaudeStatusline", () => enableClaude(context)),
    vscode.commands.registerCommand("llmVitals.disableClaudeStatusline", disableClaude),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(SECTION)) return;
      tracker = createTracker();
      start();
    }),
  );
  start();
  void offerClaudeStatusline(context).catch(() => {});
}

/**
 * Keeps an enabled status line script current after extension updates, and otherwise asks
 * once whether to enable it. Only asks people who use Claude Code and have no status line.
 */
async function offerClaudeStatusline(context: vscode.ExtensionContext): Promise<void> {
  const script = scriptSource(context);
  await refreshStatusline(script);
  if (context.globalState.get<boolean>(ASKED_KEY)) return;
  const usesClaude = await stat(statuslinePaths().configDir).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!usesClaude || (await statuslineState()).status !== "not-enabled") return;

  await context.globalState.update(ASKED_KEY, true);
  const enable = "Enable";
  const choice = await vscode.window.showInformationMessage(
    "LLM Vitals: also show tokens per second in Claude Code's terminal status line?",
    enable,
    "No thanks",
  );
  if (choice === enable) await enableClaude(context);
}

async function enableClaude(context: vscode.ExtensionContext): Promise<void> {
  await runSetup(async () => {
    const node = await nodeCommand();
    if (!node) {
      void vscode.window.showWarningMessage(
        "LLM Vitals: Claude Code's status line needs Node.js on your PATH. Install Node.js 20 or later and try again.",
      );
      return;
    }
    const state = await enableStatusline({ scriptSource: scriptSource(context), node });
    void (state.status === "other"
      ? vscode.window.showWarningMessage(
          `LLM Vitals: Claude Code already has a status line, so it was left unchanged. To use LLM Vitals instead, remove "statusLine" from ${statuslinePaths().settings} and run this command again.`,
        )
      : vscode.window.showInformationMessage(
          'LLM Vitals: Claude Code\'s status line now shows tokens per second. Run "LLM Vitals: Disable in Claude Code Status Line" to undo.',
        ));
  });
}

async function disableClaude(): Promise<void> {
  await runSetup(async () => {
    const state = await disableStatusline();
    void vscode.window.showInformationMessage(
      state.status === "other"
        ? "LLM Vitals: Claude Code's status line belongs to another tool, so it was left unchanged."
        : "LLM Vitals: removed from Claude Code's status line.",
    );
  });
}

async function runSetup(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message =
      error instanceof SetupError
        ? error.message
        : `could not update Claude Code settings (${error instanceof Error ? error.message : String(error)})`;
    void vscode.window.showErrorMessage(`LLM Vitals: ${message}`);
  }
}

function scriptSource(context: vscode.ExtensionContext): string {
  return context.asAbsolutePath("dist/statusline.cjs");
}

/** A numeric setting, kept within `[min, max]` whatever settings.json holds. */
function setting(key: string, fallback: number, min: number, max: number): number {
  const value = vscode.workspace.getConfiguration(SECTION).get<unknown>(key);
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function createTracker(): Tracker {
  return new Tracker({ activeWindowMs: setting("activeWindowMinutes", 60, 1, 10_080) * 60_000 });
}

function visible(sessions: Session[]): Session[] {
  return sessions.filter((session) => session.calls.length > 0 || session.pendingSince !== undefined);
}

function update(item: vscode.StatusBarItem, sessions: Session[]): void {
  const [latest] = sessions;
  if (!latest) {
    item.hide();
    return;
  }
  const summary = summarize(latest);
  item.text =
    summary.pendingMs === undefined
      ? `$(pulse) ${formatRate(summary.lastRate)}`
      : `$(loading~spin) ${formatDuration(summary.pendingMs)}`;
  item.tooltip = tooltip(sessions);
  item.show();
}

function tooltip(sessions: Session[]): vscode.MarkdownString {
  const rows = sessions.slice(0, 8).map((session) => {
    const s = summarize(session);
    return `| ${sourceName(session.source)} | ${escapeMarkdown(projectName(session))} | ${formatRate(s.lastRate)} | ${formatRate(s.averageRate)} | ${formatPercent(s.cacheHitRate)} |`;
  });
  return new vscode.MarkdownString(
    ["| Tool | Project | Latest | Average | Cache |", "|---|---|--:|--:|--:|", ...rows, "", "Click for details."].join(
      "\n",
    ),
  );
}

/** Escapes Markdown so names from logs show as plain text, never as links, images or table cells. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~$&:]/g, "\\$&");
}

function detail(session: Session, s: Summary): string {
  const used = s.contextUsed === undefined ? "" : ` (${formatPercent(s.contextUsed)})`;
  const context = s.contextTokens === undefined ? undefined : `context ${formatTokens(s.contextTokens)}${used}`;
  const limits = session.rateLimits?.map((limit) => `${limit.label} limit ${Math.round(limit.usedPercent)}%`);
  return [
    `latest ${formatRate(s.lastRate)}`,
    `average ${formatRate(s.averageRate)}`,
    `${s.calls} calls`,
    `output ${formatTokens(s.outputTokens)}`,
    `cache ${formatPercent(s.cacheHitRate)}`,
    context,
    ...(limits ?? []),
  ]
    .filter(Boolean)
    .join(" · ");
}

async function showSessions(sessions: Session[]): Promise<void> {
  if (!sessions.length) {
    void vscode.window.showInformationMessage("LLM Vitals: no active Claude Code or Codex sessions.");
    return;
  }
  await vscode.window.showQuickPick(
    sessions.map((session) => ({
      label: `${sourceName(session.source)} · ${projectName(session)}`,
      description: modelName(session),
      detail: detail(session, summarize(session)),
    })),
    { title: "LLM Vitals: active sessions", matchOnDetail: true },
  );
}

export function deactivate(): void {}
