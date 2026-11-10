# medicate simulator concept evolution log

Running log of how the **medicate** simulator concept sharpened during the Built-with-Opus-4.7 hackathon week. Kept for the "Keep Thinking" submission prize. Judges want to see that the idea moved, not that the first shower-thought survived to Sunday.

Each entry: what changed, why, what it replaces.

---

## Kickoff, shift from game to training tool

**What changed.**

The project started as a browser-based ER game (score, lives, dispatch). I realized the real value is clinical training: a doctor-in-training can run through a dozen cases in an hour and get grading feedback.

**Why.**

The kickoff reframed it: "build from what you know, domain expertise wins." I'm closer to clinical-training problems than to game design. The polyclinic flow I already built is actually a micro training environment. It just wasn't framed that way.

**What it replaces.**

The "score + lives" framing still exists mechanically, but the *pitch* in the demo video is now "training simulator," not "game." `GameOver.tsx` stays, but it will be renamed to something like `ShiftDebrief.tsx` in the final version.

**Implication for submission.**

Judges grading Impact will weigh a training tool higher than a game.

---

## Adding a Managed Agent as the attending

**What changed.**

The original plan was one Claude call per patient conversation (Haiku). Now there is a second Claude path: a Managed Agent playing the attending physician who watches the player work and surfaces rich-UI feedback cards via custom tools.

**Why.**

The Managed Agents special prize is specifically for using the new API primitives: Agent, Environment, Session, custom tools. Adding the attending agent checks that box *and* genuinely improves the product. Training feedback is the thing the current prototype most clearly lacks.

**What it replaces.**

The "score number in a corner" feedback loop. The attending agent gives grading as contextual cards, not as a raw number.

---

## Managed Agent scaffolding in, custom tools wired

**What changed.**

Added the full Managed Agents plumbing:

- FastAPI proxy at `/agent/*`
- A `medicate-attending` agent config on Opus 4.7 with five custom tools:
  - `render_vitals_chart`
  - `render_bed_map`
  - `render_triage_badge`
  - `render_patient_timeline`
  - `render_case_grade`
- A browser-side stream consumer that honours reconnect and idle-break handling
- A Zod-validated dispatch layer from `agent.custom_tool_use` events to React cards

**Why.**

Needed a real end-to-end path rather than a mock. Doing the plumbing before the UI cards also forces the card contracts to be Zod-defined, which means the attending agent can't silently emit a malformed card at demo time.

**What it replaces.**

A single-endpoint browser call into the Anthropic SDK (which still exists for the Haiku patient persona). Managed Agents gives Agent, Environment, Session primitives, versioning, server-side context management, and the custom-tool UI escape hatch.

**Open questions.**

Whether to route the patient-persona call through the backend too for a unified API-key story. Probably yes eventually, not this week. Idea retained in the Keep Thinking log.

---

## Permission policy, credential vault, `/loop`, and triage split

**What changed.**

Four major additions landed together:

### 1. Permission policy for custom tools

Added `CUSTOM_TOOL_PERMISSIONS` in `src/agents/customTools.ts` plus a new `flag_critical_finding` write tool gated behind an approve/decline dialog in `src/agents/eventStreamRenderer.tsx`.

The five `render_*` tools remain auto-allowed.

### 2. Credential vault

Added `POST /agent/vault/ehr/lookup` with a fake hospital-EHR store plus the `lookup_ehr_history` custom tool.

`EHR_API_TOKEN` remains server-side only. Log lines, response bodies, and response headers are asserted token-free in `backend/tests/test_vault.py`.

### 3. `/loop` slash commands

`.claude/commands/medicate-verify-simulation.md` wraps `scripts/loop/verify-loop.ts`, which appends timestamped PASS/FAIL entries to `verify.log`.

`.claude/commands/medicate-idea-evolve.md` drives this evolution log on a recurring cadence (draft-only, never auto-write).

### 4. Dedicated triage-reasoning path

`POST /agent/triage/classify` became a direct Opus 4.7 inference path (not via Managed Agents) with an ESI-rules system prompt mirroring `.claude/skills/medicate-triage-logic.md`.

The pure function `run_triage_reasoning` is unit-tested with a mocked Anthropic client. The browser client is `src/agents/triageReasoning.ts`.

### Test coverage

Added a zero-dependency Node 22+ test harness in `scripts/test/` (30 TypeScript tests) alongside `backend/tests/` (22 Python tests).

Run with:

```bash
npm test
