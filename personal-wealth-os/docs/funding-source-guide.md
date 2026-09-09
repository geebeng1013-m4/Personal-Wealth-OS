# Funding Source Usage Guide

How to tag `fundingSource` (`personal` / `sponsored`) on ledger transactions in
real life — the rules this doc captures came out of working through several
real scenarios, not just the happy path.

## The core idea

Every income/expense transaction can be tagged:

- **personal** (default, no tag needed) — this is your own money. It counts
  toward your budget, spending limit, and category breakdown.
- **sponsored** — money that passed through your account but was never
  really yours to budget (a parent's money for a specific errand). It is
  still fully recorded (account balance, cash-flow totals, History) but is
  excluded from personal budget math (Budget page, Advisor's spending limit,
  Money Leaks, Category Share).

## The one rule that matters

> **Tag `sponsored` only at the moment a transaction has a clear, stated
> purpose tied to it. Never try to trace which "pool" of money funded a
> purchase after the fact — money in one account is fungible, and once it's
> blended in, you genuinely cannot know (and shouldn't try to guess).**

This rule exists because an earlier, more "precise"-sounding approach —
tracking exactly how much unspent sponsored money is still sitting in your
account, and converting it to personal in a lump sum once it gets big — turns
out to ask the impossible. You cannot know which ringgit in your wallet came
from your salary and which came from a parent's gift three weeks ago. Don't
try. Tag at the moment of clear correspondence and stop there.

## Scenarios

### 1. Money given in advance for a specific purpose

Parent hands you RM20, says "buy dinner."

```
Income  RM20  fundingSource: sponsored
Expense RM18  fundingSource: sponsored   (the dinner)
```

The RM2 left over just sits in your account as ordinary cash. **Do nothing
with it.** It doesn't need a transaction, a label, or tracking. It's real
money, correctly reflected in your balance — it only becomes a problem if you
later mislabel spending it (see "Don't do this" below).

### 2. You pay first, parent reimburses you later (your actual pattern)

You spend RM13.90 + RM14 + RM19 = RM46.90 out of your own account. Later that
day (or the next), your parent gives you money back to cover it — sometimes
the exact amount, sometimes a little more.

**At time of purchase**, if you already know this kind of spending is usually
reimbursed, tag it sponsored right away:

```
Expense RM13.90  fundingSource: sponsored
Expense RM14.00  fundingSource: sponsored
Expense RM19.00  fundingSource: sponsored
```

If you're not sure yet whether it'll be reimbursed, tag it `personal` (the
honest default at that moment) and come back and edit it (✎ in the History
list) once the reimbursement actually happens.

**When the reimbursement comes in:**

- If it matches exactly (RM46.90) → one income entry, `sponsored`. Done.
- If it's a little more (say RM50, RM3.10 extra) → **don't bother splitting
  it into two entries for a few ringgit.** Just record the whole RM50 as
  `sponsored`. The RM3.10 becomes unspent leftover cash — see "leftover"
  below, same as scenario 1.
- If it's *meaningfully* more, and your parent said something like "keep the
  rest" — that's really a personal gift riding along with a reimbursement.
  Only then is it worth two entries: `sponsored` for the amount that matches
  your expense, `personal` for the explicit extra.

### 3. Leftover / change from sponsored money

Whether from scenario 1 or 2, small unspent leftovers (a few ringgit) are not
worth tracking. Leave them as ordinary cash. **Don't** try to maintain a
running "how much sponsored float do I still have" total, and don't do
periodic lump conversions to personal — both of those require tracing
fungible money after the fact, which is the thing rule one says not to do.

## Don't do this

- ❌ Don't skip recording a sponsored transaction to avoid "polluting" your
  budget. The Ledger must record every real money movement — that's what
  keeps your account balance and net worth correct. Budget exclusion is what
  the `fundingSource` tag is for; it is not a reason to under-record.
- ❌ Don't retroactively decide "this purchase was probably funded by that
  leftover sponsored money from last week" and tag it sponsored to keep your
  budget looking clean. If a purchase doesn't have a clear, stated purpose at
  the time, it's `personal` — even if some untraceable sliver of the cash in
  your account technically originated from a parent's gift.
- ❌ Don't split every reimbursement into two income entries "to be precise."
  Only split when the extra amount is large enough, and explicitly framed as
  yours to keep, that it would meaningfully change your available personal
  budget.

## Known limitation (accepted, not a bug)

If you ever do mislabel spending from blended/leftover cash as `personal`
with no matching `personal` income behind it, your personal budget will look
very slightly worse than reality by that amount. For a few ringgit at a time
this is negligible and self-correcting in spirit — not worth chasing. It only
becomes worth noticing if it happens at a scale of RM50–100+ in one go, in
which case just be more deliberate about that one transaction's tag; it
doesn't call for a systemic fix.

## What's NOT built (and shouldn't be, per the above)

- A running "sponsored balance / unspent float" indicator. Since rule one
  says you shouldn't be tracing fungible funds after the fact, there is
  nothing for such an indicator to correctly measure — it was considered and
  deliberately not built.
