# Quality System

Read this before fixing or auditing anything.

This exists because on a sibling repo, 21 audit passes raised ~679 findings and
it felt unbounded. It wasn't: those findings collapsed to ~12 recurring root
causes — 47% of the newest audit traced to two of them, and three of its four
"blockers" were a single defect seen from three angles. Bugs kept coming back
for two reasons. Every fix patched an **instance** and left the **class** open,
so the next sibling was only a matter of time. And every automated guard was a
text search over source code, so every *data*-shaped defect family (an RLS
policy, a missing DB constraint, a live row) was invisible to CI by
construction.

This document is the discipline that closes that gap. It is short on purpose.

---

## The one rule

**Fix the class, not the instance.**

A fix is not done until something automatic would catch the *next* instance.
Whenever you can, replace an enumerated list ("check these 41 call sites") with a
rule ("no call site can do this"). A rule survives the next refactor; a list
rots the moment someone adds row 42.

---

## What "done" means

All four, or it is not "fixed" — it is "instance patched", and you say so in
those words:

1. **The instance is fixed.**
2. **The class is named** — which family (see the registry below). If it is a
   new kind, add the family in the *same commit* as the fix.
3. **Siblings were searched for** and either fixed or listed with evidence. A
   family is never one row; if you found only one, you have not looked yet.
4. **A guard exists** — something automatic that fails on the next instance. If
   a guard is genuinely impossible, write down *why*, and what a human checks
   instead, so the gap is visible rather than assumed-covered.

If you cannot honestly claim all four, mark the item **partial** and name which
of the four is missing. "Instance patched" is an acceptable state to leave
something in; silently calling it "fixed" is not.

---

## The guard ladder

Prefer the highest rung you can actually reach. A weaker guard in a higher-value
spot beats a stronger guard you never ship.

1. **A database constraint or trigger.** Cannot be bypassed by any code path,
   any future agent, or a direct SQL write. This is the only rung that closes a
   data-shaped family. Reach for it first for anything about uniqueness,
   overlap, referential integrity, required columns, or a value that must always
   hold.
2. **A build-time check that blocks the deploy.** Ship it as a **ratchet**
   against a checked-in baseline, so it fails only on something *new*. A check
   that fails on 41 pre-existing sites gets disabled within a day — and then you
   have neither the guard nor the fix. Fix-or-baseline every existing site in
   the same change that adds the check.
3. **A runtime assertion that alerts.** It fires in production and someone is
   told. A failure that only writes to a log no one reads is not a guard — make
   the failure to alert itself alertable, and add a canary that proves the path
   works when nothing is broken.
4. **A documented human step.** The weakest rung — a checklist entry, a review
   note. Use it only when 1–3 are truly impossible, and say why they were.

---

## Rules for auditing

- **Never report an absence you did not instrument for.** If you did not run the
  check, the finding is "unverified", not "absent" and not "clean".
- **An empty result is not a clean result.** Prove the check *works* — plant a
  violation and confirm it trips — before reporting all-clear. A check that
  passes because it is silently broken is worse than no check.
- **Verify against production, not a local build.** Unset local env vars
  manufacture fake blockers; a local schema drifts from the live one.
- **The live system of record is the authority** — the running database, not
  generated type files, which go stale the moment the schema moves.
- **Adversarially verify.** Hand every finding to a skeptic told to refute it.
  Measured refutation rates run ~20% and reached 79% in one pass, so an
  unrefuted list is roughly a third noise. Report only what survived.
- **Deduplicate before counting.** Report **two** numbers: findings raised, and
  distinct classes behind them. The second number is the one that matters.
- **Audit the guards themselves.** They are code. Prove each one fails on a
  planted violation; a guard you never tested is a comforting no-op.

---

## Rules for reporting

- **"Fixed"** means the class is closed *and* guarded. Anything less is
  **"instance patched"** — use those words.
- **"Live"** means verified in production. Not committed. Not merged. Not "the
  PR is green."
- **Always publish what you did NOT verify.** An audit without an explicit
  "not verified" list is marketing, not an audit.

---

## The defect-class registry

Families are specific to *this* codebase and must be discovered from its own
history — a bug family that dominated the sibling repo may not exist here, and
this repo will grow its own. Do not copy another repo's families in.

**The rule for adding a family:** the same *kind* of bug seen twice is a class.
Adding a row requires, in the same commit as the fix:

- a one-line **name** for the family,
- at least **two instances** with `file:line` or a query as evidence (a family
  is never one row), and
- a candidate **guard** from the ladder above.

Until a kind of bug has appeared twice here, it is not yet a family — leave the
table empty rather than inventing rows. See `docs/agents/audit-of-audits.md` for
the discovery pass that populates this once there is enough history to run it.

| # | Family | Recurrence | Guard that would close it |
|---|--------|------------|---------------------------|
| _(empty — add the first family the first time the same kind of bug appears twice here)_ | | | |
