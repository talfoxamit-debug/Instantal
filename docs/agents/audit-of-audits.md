# Audit of Audits — a discovery prompt

A reusable prompt for a future agent. Its job is **not** to find new bugs. Its
job is to find the *root causes behind the bugs already found*, so this repo can
fill in the defect-class registry in `docs/QUALITY_SYSTEM.md` and start fixing
classes instead of instances.

Read `docs/QUALITY_SYSTEM.md` first. Then run this pass exactly as written.

> **When to skip.** In a young repo with no audit history — no findings docs, no
> tracker of confirmed bugs, few or no "fix" commits — do **not** run this. There
> is nothing to mine, and a discovery pass over an empty corpus manufactures
> families that do not exist. Start with the empty registry table and add a
> family the first time the same *kind* of bug appears twice. Come back and run
> this once there is real history.

---

## Rules of engagement

- **Work READ-ONLY.** Change nothing. This pass produces a report, not a fix.
- **Look backward, not forward.** You are cataloguing causes behind findings
  that already exist — not opening new findings. If you spot a genuinely new
  bug, note it in one line and move on; it is not this pass's product.
- **Read the whole history**, not a sample:
  - findings / audit / review documents in the repo,
  - the issue tracker (open and closed),
  - PR review comments,
  - commits whose message contains "fix" (and "revert" — a revert is a fix that
    failed).
- **Deduplicate before counting**, and **adversarially verify**: a finding a
  skeptic can refute does not count toward a family. Apply the auditing rules in
  `docs/QUALITY_SYSTEM.md`.

---

## What to report

Lead and close with the parts a non-technical reader needs; put the mechanics in
between.

1. **Plain-language verdict (first).** For a non-technical reader deciding
   whether this work is *finishable*: is the bug surface unbounded, or a few
   systemic causes wearing many faces? Answer in a sentence or two, then back it
   with the numbers below.

2. **The corpus.** Passes run; findings raised; findings that stood; findings
   refuted; the **refutation rate**. If a number is unknown, say "unverified" —
   do not estimate it into existence.

3. **Duplication.** How much repetition *within* a single pass and *across*
   passes. Report it as a measured number, not an impression.

4. **The families.** The recurring root causes. For each:
   - a one-line name,
   - instance count and the `file:line` / query evidence,
   - the span of passes it appears in — first sighting and last sighting,
   - whether **one mechanical check** could catch the entire family, and which
     rung of the guard ladder that check sits on.

5. **The direct answer.** In numbers: "N findings collapse to M classes." That
   ratio is the whole point of the pass.

6. **Fixed-but-incomplete (usually the most valuable section).** Items marked
   "fixed" that closed only an instance — the class is still open, or the guard
   is missing. These are where the next regression is already scheduled.

7. **Existing guards and their blind spots.** Every guard the repo has, and what
   it *structurally cannot see* — e.g. a grep-based check is blind to every
   data-shaped family (RLS, DB constraints, live rows) by construction.

8. **Harness artifacts.** Any place a past pass manufactured its own findings —
   a check that reported an absence it never instrumented for, a test that wrote
   to a real database, an unset local env var that faked a blocker. These
   poison the corpus and must be called out.

9. **"Not verified" (last).** Everything this pass did not or could not check.
   An audit-of-audits without this list is marketing.

---

## Output

Write the result to a dated report under `docs/agents/` (or this repo's audit
location). Then, for each family that meets the registry bar in
`docs/QUALITY_SYSTEM.md` — a named kind seen at least twice, with evidence and a
candidate guard — propose the registry row. Adding the row itself happens in the
same commit as the fix that closes the family, never speculatively here.
