# pi-design-log

A [Pi coding agent](https://github.com/badlogic/pi-mono) extension that maintains a persistent per-project design log and provides a fresh-session code review against it.

## What it does

- **Auto-captures** every interactive user prompt into `.pi/design-log.md`
- Provides a **`design_log` tool** for the LLM to record design decisions, Q&A, and key principles
- **Survives compaction** — the full log is re-injected on every agent turn via `before_agent_start`, so the agent always has complete design context
- **`/review`** command creates a fresh session with all uncommitted changes and reviews them against the design log
- **`/design`** command to view log status
- **`/design-clear`** command to reset (with confirmation)

## Install

From a git repo:

```bash
pi install git:github.com/YOUR_USER/pi-design-log
```

Or from npm:

```bash
pi install npm:pi-design-log
```

Or try without installing:

```bash
pi -e git:github.com/YOUR_USER/pi-design-log
```

Or from a local path:

```bash
pi install /path/to/pi-design-log
```

## Usage

Just talk to pi. The extension:

1. Auto-captures your prompts to `.pi/design-log.md`
2. Reminds the agent every turn to use the `design_log` tool for recording decisions
3. The agent records Q&A decisions and principles as you discuss them
4. When ready to commit, run `/review` for an unbiased code review in a fresh session

### Commands

| Command | Description |
|---------|-------------|
| `/review` | Start a fresh session reviewing all uncommitted changes against the design log |
| `/design` | Show design log file path and status |
| `/design-clear` | Clear the design log (with confirmation) |

### `/review` flow

1. Waits for the agent to finish current work
2. Gathers all uncommitted changes: unstaged diffs, staged diffs, and untracked files
3. Truncates large diffs (saves full version to a temp file the agent can read)
4. Creates a **completely fresh session** (blank slate, no prior reasoning)
5. Sends a review prompt with the diffs, design log reference, and thorough review instructions

The fresh session ensures the review is unbiased — no prior reasoning can influence the analysis.

### Tool actions

The LLM uses `design_log` with these actions:

| Action | Description |
|--------|-------------|
| `read` | Read the full design log |
| `record_decision` | Record a Q&A decision (requires `question` + `answer`) |
| `record_principle` | Record a key design principle |
| `clear` | Clear the entire log |

## Design log format

The log is a markdown file at `.pi/design-log.md` that grows chronologically:

```markdown
# Design Log

---

### [2026-04-22 14:30] User Prompt

I want to add a caching layer to the API endpoints...

### [2026-04-22 14:35] Design Decision

**Q:** Should we use Redis or in-memory?
**A:** Redis for distributed, in-memory fallback for dev

### [2026-04-22 14:36] Key Principle

- Cache invalidation must be event-driven
```

## License

MIT
