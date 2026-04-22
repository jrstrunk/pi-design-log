/**
 * Design Log Extension
 *
 * Automatically captures all user prompts and provides a persistent per-project
 * design log that survives context compaction and session restarts.
 *
 * The agent uses the `design_log` tool to record design decisions (Q&A) and
 * key principles. The full log is re-injected on every agent turn via
 * `before_agent_start`, so the agent always has complete design context
 * regardless of compaction.
 *
 * Features:
 *   - Auto-captures every interactive user prompt into .pi/design-log.md
 *   - `design_log` tool for recording decisions, principles, and reading the log
 *   - Strong emphasis injection on every agent turn with full log content
 *   - `/design` command to view the log
 *   - `/design-clear` command to reset (with confirmation)
 *   - `/review` command to start a fresh session reviewing code changes against the design log
 *
 * Placement: ~/.pi/agent/extensions/design-log.ts (global, works for all projects)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	truncateHead,
	formatSize,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	appendFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";

// ─── Constants ───────────────────────────────────────────────────────────────

const DESIGN_LOG_REL = ".pi/design-log.md";

const HEADER = `# Design Log

> Auto-generated design discussion log.
> This file is the single source of truth for all design decisions in this project.
>
> Commands: \`/design\` to view · \`/design-clear\` to reset

---

`;

// ─── File helpers ────────────────────────────────────────────────────────────

function logPath(cwd: string): string {
	return resolve(cwd, DESIGN_LOG_REL);
}

function ensureFile(cwd: string): void {
	const p = logPath(cwd);
	if (!existsSync(p)) {
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, HEADER, "utf8");
	}
}

function readLog(cwd: string): string {
	const p = logPath(cwd);
	if (!existsSync(p)) return "";
	return readFileSync(p, "utf8");
}

function appendLog(cwd: string, text: string): void {
	ensureFile(cwd);
	appendFileSync(logPath(cwd), text, "utf8");
}

function clearLog(cwd: string): void {
	writeFileSync(logPath(cwd), HEADER, "utf8");
}

function isEmpty(content: string): boolean {
	return !content || content.trim().length <= HEADER.trim().length + 5;
}

function ts(): string {
	return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function designLogExtension(pi: ExtensionAPI) {
	// ── 1. Auto-capture user prompts ───────────────────────────────────────
	//
	// Hooks into the `input` event (fires before skill/template expansion).
	// Captures every interactive user message and appends it to the design log.
	// Skips slash commands, bash shortcuts (!), and extension-injected messages.

	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive") return { action: "continue" };

		const text = event.text.trim();
		if (!text) return { action: "continue" };
		if (text.startsWith("/")) return { action: "continue" };
		if (text.startsWith("!")) return { action: "continue" };

		const images = event.images?.length
			? `\n> *[${event.images.length} image(s) attached]*\n`
			: "";

		const entry = `\n### [${ts()}] User Prompt\n\n${text}${images}\n`;
		appendLog(ctx.cwd, entry);

		return { action: "continue" };
	});

	// ── 2. Inject design log context on every agent turn ───────────────────
	//
	// This is the key mechanism that makes the design log survive compaction.
	// The full log content is injected as a hidden message before each agent
	// loop, so the LLM always has complete design context.

	pi.on("before_agent_start", async (_event, ctx) => {
		const content = readLog(ctx.cwd);
		if (isEmpty(content)) return;

		return {
			message: {
				customType: "design-log-context",
				content: `[CRITICAL — DESIGN LOG IS ACTIVE]

A design log exists at \`${DESIGN_LOG_REL}\`. This log is the SINGLE SOURCE OF TRUTH for all design decisions in this project. It persists across context compaction and session restarts — you will see this reminder on every turn.

MANDATORY RULES:
1. ALWAYS read the full design log (design_log action: "read") before proposing or implementing any design change.
2. ALWAYS record every design decision (design_log action: "record_decision") as soon as you and the user agree on an approach. Do not wait — record immediately.
3. ALWAYS record key design principles (design_log action: "record_principle") that should guide implementation.
4. NEVER contradict or ignore a recorded decision without first discussing it with the user and getting explicit approval to change course.
5. When implementing, verify your approach is consistent with ALL recorded decisions and principles.
6. If you are unsure about a design choice, check the design log first before asking the user — they may have already answered that question.

--- DESIGN LOG CONTENT (READ THIS CAREFULLY) ---
${content}
--- END DESIGN LOG ---`,
				display: false,
			},
		};
	});

	// ── 3. Prune stale design-log-context messages from context ────────────
	//
	// The before_agent_start handler re-injects the full log on every turn.
	// To avoid accumulating duplicate copies, remove older injections from
	// the message history. The fresh injection is added AFTER context
	// filtering, so it is always present for the current turn.

	pi.on("context", async (event) => {
		const filtered = event.messages.filter((m: any) => m.customType !== "design-log-context");
		if (filtered.length !== event.messages.length) {
			return { messages: filtered };
		}
	});

	// ── 4. design_log tool ────────────────────────────────────────────────

	pi.registerTool({
		name: "design_log",
		label: "Design Log",
		description: [
			"CRITICAL TOOL — The design log is the authoritative record of all design decisions for this project.",
			"Use it to record and look up every design decision, Q&A, and key principle.",
			"",
			'Actions:',
			'  "read"              — Read the full design log. DO THIS before making any design decision.',
			'  "record_decision"   — Record a design Q&A decision. Requires "question" and "answer".',
			'  "record_principle"  — Record a key design principle. Requires "principle".',
			'  "clear"             — Clear the entire design log (use sparingly, typically only when starting a new feature).',
		].join("\n"),
		promptSnippet:
			"Record and read design decisions, Q&A, and key principles in the persistent design log",
		promptGuidelines: [
			"CRITICAL: Use design_log action 'record_decision' EVERY TIME you and the user agree on a design decision. Do not wait — record immediately.",
			"CRITICAL: Use design_log action 'record_principle' to capture key design principles that should guide all implementation.",
			"CRITICAL: Use design_log action 'read' before implementing ANY feature to ensure your approach is consistent with all recorded decisions.",
			"The design_log is the single source of truth. Never contradict a recorded decision without explicit user approval to change course.",
			"When in doubt about a design choice, read the design_log first — the user may have already made that decision.",
		],
		parameters: Type.Object({
			action: StringEnum(["read", "record_decision", "record_principle", "clear"] as const),
			question: Type.Optional(
				Type.String({ description: "The design question being decided (for record_decision)" }),
			),
			answer: Type.Optional(
				Type.String({ description: "The agreed-upon answer or decision (for record_decision)" }),
			),
			principle: Type.Optional(
				Type.String({ description: "A key design principle to record (for record_principle)" }),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "read": {
					const content = readLog(ctx.cwd);
					if (isEmpty(content)) {
						return {
							content: [
								{
									type: "text",
									text: "Design log is empty. No decisions have been recorded yet.",
								},
							],
							details: {},
						};
					}
					return {
						content: [{ type: "text", text: content }],
						details: {},
					};
				}

				case "record_decision": {
					if (!params.question) throw new Error("'question' is required for record_decision");
					if (!params.answer) throw new Error("'answer' is required for record_decision");

					const entry = `\n### [${ts()}] Design Decision\n\n**Q:** ${params.question}\n\n**A:** ${params.answer}\n`;
					appendLog(ctx.cwd, entry);

					return {
						content: [
							{
								type: "text",
								text: `✓ Recorded design decision:\nQ: ${params.question}\nA: ${params.answer}`,
							},
						],
						details: {},
					};
				}

				case "record_principle": {
					if (!params.principle) throw new Error("'principle' is required for record_principle");

					const entry = `\n### [${ts()}] Key Principle\n\n- ${params.principle}\n`;
					appendLog(ctx.cwd, entry);

					return {
						content: [
							{
								type: "text",
								text: `✓ Recorded design principle: ${params.principle}`,
							},
						],
						details: {},
					};
				}

				case "clear": {
					clearLog(ctx.cwd);
					return {
						content: [{ type: "text", text: "Design log has been cleared." }],
						details: {},
					};
				}

				default:
					throw new Error(`Unknown action: ${(params as any).action}`);
			}
		},
	});

	// ── 5. /design command (view log path) ─────────────────────────────────

	pi.registerCommand("design", {
		description: "View the design log file path and status",
		handler: async (_args, ctx) => {
			const p = logPath(ctx.cwd);
			if (!existsSync(p)) {
				ctx.ui.notify(
					"No design log found. Start a conversation to auto-create one.",
					"info",
				);
				return;
			}
			const content = readLog(ctx.cwd);
			if (isEmpty(content)) {
				ctx.ui.notify(`Design log exists but is empty: ${p}`, "info");
			} else {
				const lines = content.split("\n").length;
				ctx.ui.notify(`Design log (${lines} lines): ${p}`, "info");
			}
		},
	});

	// ── 6. /design-clear command ───────────────────────────────────────────

	pi.registerCommand("design-clear", {
		description: "Clear the design log for this project (with confirmation)",
		handler: async (_args, ctx) => {
			const ok = await ctx.ui.confirm(
				"Clear Design Log?",
				"This will permanently erase all recorded design decisions, prompts, and principles. This cannot be undone.",
			);
			if (ok) {
				clearLog(ctx.cwd);
				ctx.ui.notify("Design log cleared.", "info");
			}
		},
	});

	// ── 7. /review command ─────────────────────────────────────────────────
	//
	// Starts a completely fresh session (blank slate) with:
	//   - All uncommitted code changes (unstaged + staged + untracked)
	//   - Design log reference
	//   - Thorough review instructions
	//
	// The new session cannot be influenced by prior reasoning, ensuring
	// an unbiased code review against the design decisions.

	pi.registerCommand("review", {
		description: "Review all uncommitted code changes against the design log in a fresh session",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			// 1. Gather all uncommitted changes
			const diffResult = await pi.exec("git", ["diff"], { cwd: ctx.cwd, timeout: 10000 });
			const cachedResult = await pi.exec("git", ["diff", "--cached"], { cwd: ctx.cwd, timeout: 10000 });
			const untrackedResult = await pi.exec(
				"git", ["ls-files", "--others", "--exclude-standard"],
				{ cwd: ctx.cwd, timeout: 10000 },
			);

			const hasUnstaged = diffResult.stdout.trim().length > 0;
			const hasStaged = cachedResult.stdout.trim().length > 0;
			const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);

			if (!hasUnstaged && !hasStaged && untrackedFiles.length === 0) {
				ctx.ui.notify("No uncommitted changes to review.", "warning");
				return;
			}

			// 2. Build diff content
			let diffContent = "";

			if (hasUnstaged) {
				diffContent += "=== Unstaged Changes ===\n" + diffResult.stdout + "\n";
			}
			if (hasStaged) {
				diffContent += "=== Staged Changes ===\n" + cachedResult.stdout + "\n";
			}
			if (untrackedFiles.length > 0) {
				diffContent += "=== Untracked Files ===\n";
				for (const file of untrackedFiles) {
					const filePath = resolve(ctx.cwd, file);
					if (!existsSync(filePath)) continue;
					try {
						const stat = await import("node:fs").then((fs) => fs.statSync(filePath));
						if (stat.size > 20_000) {
							diffContent += `\n+++ ${file} (new file, ${formatSize(stat.size)} — use read tool)\n`;
							continue;
						}
						const content = readFileSync(filePath, "utf8");
						diffContent += `\n+++ ${file} (new file)\n${content}\n`;
					} catch {
						diffContent += `\n+++ ${file} (could not read)\n`;
					}
				}
			}

			// 3. Truncate if large, save full version to temp file
			const truncation = truncateHead(diffContent, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let diffForPrompt = truncation.content;
			if (truncation.truncated) {
				const tmpFile = resolve(tmpdir(), `pi-review-${Date.now()}.diff`);
				writeFileSync(tmpFile, diffContent, "utf8");
				diffForPrompt +=
					`\n\n[Diff truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
					`(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
					`Full diff saved to: ${tmpFile}]`;
			}

			// 4. Check design log
			const hasDesignLog = !isEmpty(readLog(ctx.cwd));

			// 5. Build review prompt
			let prompt = "## Code Review Request\n\n";
			prompt += "Review the following uncommitted code changes.\n\n";

			if (hasDesignLog) {
				prompt +=
					"A design log exists for this project. Use the `design_log` tool to read it before starting your review. " +
					"The design log contains the original prompts, design decisions, and key principles that should guide this review.\n\n";
			}

			prompt += "### Changes\n\n```diff\n" + diffForPrompt + "\n```\n\n";

			prompt += "### Review Instructions\n\n";
			prompt += "Look at the code changes. ";
			if (hasDesignLog) {
				prompt += "Do they match the intent laid out by the design log? ";
			}
			prompt += "Were any code smells left behind? Were any patterns used that are inconsistent or could be improved? ";
			prompt += "Are there any bugs in the implementation? Was any TODO or tech debt left to do? ";
			prompt += "Be thorough in your analysis. Go for the gold standard of software engineering.";

			// 6. Create a fresh session — blank slate, no prior reasoning
			const result = await ctx.newSession({
				parentSession: ctx.sessionManager.getSessionFile(),
				setup: async (sm) => {
					sm.appendMessage({
						role: "user",
						content: [{ type: "text", text: prompt }],
						timestamp: Date.now(),
					});
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("Review session cancelled.", "warning");
			}
		},
	});
}
