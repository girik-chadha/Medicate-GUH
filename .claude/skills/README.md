# Skills catalog — medicate

The simulator runs on **one Managed Agent** (`medicate-attending`, Opus 4.7) plus a small
set of skills that compose around it. The agent is the only stateful actor that
talks to the trainee at run-time; skills are utilities that author or refresh
the data the agent grades against.

Two flavours of skill live here:

- **Authoring skills** — invoked on demand to extend the registry, add cases,
  or write rubrics. These are the ones with rich input contracts and
  citation-discipline rules.
- **Operational skills** — invoked while the simulator runs (`/loop`-style or
  one-shot) to keep things working: bootstrap, verify, demo capture.

## Architecture

```
trainee ──► medicate-attending Managed Agent (Opus 4.7) ──► render_case_evaluation
                  ▲                                       │
                  │ rubric + registry                     ▼
                  │                                 <CaseEvaluationCard>
   [registry]  guidelines.ts (NICE/ESC/AHA/...)
       ▲
       │ weekly /loop
   ┌───┴────────────────────────────┐
   │medicate-guideline-curator       │
   └────────────────────────────────┘

   [case rubrics]  polyclinicPatients.ts.rubric
       ▲
       │ on-demand
   ┌───┴────────────────────┐
   │ medicate-rubric-author   │
   └────────────────────────┘
```

direct store mutations in `src/game/store.ts`, no agent gating layer.

