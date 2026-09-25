# Granite — Claude Code Guidelines

Behavioral guidelines for working on this codebase.
Karpathy principles (§1–4) apply to all tasks. Colony conventions (§5–8) are project-specific.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- If a good open-source library or tool would do the job better than hand-rolled code
    (e.g. an agent framework, a parser, a validation lib), **stop and ask me to approve it
  before adding the dependency.** Name the library, what it replaces, and the trade-off.
  Do not silently add new dependencies.

---

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

---

## 3. Consult the Memory Bank Before Starting Work

**ก่อนทำงานส่วนไหน ไปเช็ค Memory Bank ของส่วนนั้นก่อนเสมอ**

Every feature/part of the codebase has its own folder under `memory bank/`. Before
starting any task in an area, **read that folder first** (mainly `activeContext.md`,
`systemPatterns.md`, and `progress.md`) so you understand the code structure, current
state, and goals before touching code.


If you are unsure which memory bank applies, search `memory bank/` and the backend/frontend
structure **before** asking or starting. Do not begin work without checking the relevant
memory bank.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.



---

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---


---



### AI provider
- **Primary:** OpenRouter (`openrouter_api_key` in Settings, base `https://openrouter.ai/api/v1`)
- **Fallback:** OpenAI (`openai_api_key` in Settings)
- Always check `settings.openrouter_api_key` first. Never hardcode provider order in a new module — follow the pattern in `backend/app/ai_ant/orchestrator.py`.



### Settings
- All config goes through `get_settings()` from `backend/app/config.py` (Pydantic `BaseSettings`).
- Never `os.environ.get()` directly in route handlers or business logic.

---

---

## 8. These Guidelines Are Working If

- Diffs contain only lines that trace to the request — no drive-by formatting.
- New components appear in `src/pages/<feature>/` or `src/components/`, not in `App.tsx`.
- `npx tsc -b` passes after every change. (Not `tsc --noEmit` — `frontend/tsconfig.json` is
  references-only, so bare `--noEmit` checks 0 files and always exits 0, false-clean.)
- Clarifying questions come **before** implementation, not after mistakes.
- Backend features follow the `router / schemas / logic` module pattern.


Before making frontend changes:

Review the current backend implementation.
Identify existing APIs and features.
Use real APIs whenever they are available.
Never replace a working API with mock data.

If a feature does not exist in the backend yet:

You may create temporary mock data.
Clearly label it as TEMPORARY MOCK DATA.
Keep the data structure compatible with the future backend API.
Document the API that will eventually replace the mock.

If you are unsure whether an API exists, ask first.

Backend is the source of truth.
