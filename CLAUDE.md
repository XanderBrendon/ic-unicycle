# CLAUDE.md



**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

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

## 5. Commit style

- Concise messages. One line is usually enough; only add a body when the "why" isn't obvious.
- **Do not add a `Co-Authored-By: Claude ...` trailer.** Plain commits only.

## 6. Use the icp-sdk client libraries

**Prefer the official `@icp-sdk/*` family over custom-rolled equivalents.**

Whenever the official client (`@icp-sdk/auth`, `@icp-sdk/core`, `@icp-sdk/canisters/...`, `@icp-sdk/bindgen`) covers what you need — agent construction, II auth, ICRC ledger reads/writes/approvals, candid bindgen, etc. — call into it instead of reimplementing. Do not custom-roll functionality the official client already provides.

If the client covers most of what you need but is missing a specific piece, narrow your custom code to that piece — don't replace the rest. When in doubt, check the installed `.d.ts` types under `node_modules/@icp-sdk/` before writing parallel logic. For libraries not yet installed, consult the official SDK documentation at https://js.icp.build/ to see whether a packaged solution exists before reaching for a custom implementation.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

