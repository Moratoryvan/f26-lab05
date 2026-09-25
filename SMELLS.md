# reservation-service: Smells and One Fix

Fill in each section. One section per milestone. Keep it short and specific. Point at files
and methods, not adjectives.

---

## Milestone 1: Three smells

Three smells, each in a different part of the module. For each one, fill in all five parts.

### Smell 1

**The smell.** Duplication over reuse.

**Classic or agent-specific.** Agent-specific, the rule is re-derived and the constants renamed to match the new file's
vocabulary, which is what writing a file without the rest of the repo in view produces. Each
file reads fine alone, so the duplication is visible only across files. (`priceOf` is also
feature envy: it touches no field of `ReportGenerator`, only `room` and `booking`, so by
Information Expert the price belongs where the data is.)

**Where in the code.** `src/reportGenerator.ts`, `priceOf` (lines 104-117) and `revenue`,
against `src/reservationManager.ts`, `calculatePrice` and `applyDiscounts` (lines 140-158).
`priceOf` re-implements `calculatePrice`/`applyDiscounts` step for step, including a second
copy of all four constants under new names (`PREMIUM_RATE_MULTIPLIER` vs
`PREMIUM_MULTIPLIER`, `LONG_BOOKING_CUTOFF` vs `LONG_BOOKING_MINUTES`, same values). This is
the lecture's `Room.isFree` / `BookingHelper.checkAvailable` slide, in TypeScript. Same
pattern one level down: `availability.freeMinutes` (line 49) is exported and called by
nobody, while `ReportGenerator.occupancy` hand-rolls the same window-clamping inline at lines
43-48.

**The principle it violates.** Information hiding (Parnas).

**What it makes expensive.** The pricing rule now lives in two files, so changing it is
shotgun surgery: every rule change (evening discount 0.95 to 0.90, say) has to land in both,
and the only test that would catch the drift is `reporting.test.ts:36`, which pins
`totalCents` to `morning.priceCents + evening.priceCents` for one room on one path. Something
already goes wrong, too. `revenue()` ignores the stored `booking.priceCents` and recomputes
from `room.hourlyRateCents` as it stands now, so re-registering a room at a new rate silently
rewrites every historical revenue report while the receipts already sent still say the old
number. `reportGenerator.ts:73-76` also drops any booking whose room is no longer in the
`rooms` array, so deregistering a room erases its revenue with no error.

### Smell 2

**The smell.** Phantom complexity.

**Classic or agent-specific.** Agent-specific, from free volume. Generating a full cache with
TTL, eviction, and an enable flag costs the author nothing, so there was no reason to stop at
what the module needed; every one of those lines still has to be read, reviewed, and kept
working. Missing context shows up too, in the half-wired call site: the read side got written,
the write side and the invalidation never did. The classic sibling is dead code, but this is
not dead code left over from something that once worked; it is machinery that was never
connected.

**Where in the code.** `src/cache/queryCache.ts` and `src/cache/cacheConfig.ts`, plus the one
call site, `ReservationManager.listBookingsForRoom` (lines 117-124). That method builds a
cache key, calls `this.cache.get`, and falls through to storage. `this.cache.set` is called
nowhere in the repo, so the hit branch is unreachable and every call goes to storage.
`QueryCache.set`, `invalidate`, and `size`, plus `cacheConfig`'s `withTtl` and `disabled`,
have no callers at all: two files and 79 lines of TTL and eviction machinery that cannot run.
Nothing here varies, either. There is one read path, no measured cost, and no second policy.

**The principle it violates.** Decouple what varies, and only what varies.

**What it makes expensive.** The obvious completion is a trap. Add the one missing
`this.cache.set(cacheKey, ...)`, which is the first change any reader would make, and a
stale-read bug arrives with it, because neither `createBooking` nor `cancelBooking`
invalidates anything. What breaks first: `formatDailySummary` still lists a cancelled booking
as confirmed and overstates the confirmed total for 30 seconds, while `findAvailableSlots`,
which bypasses the cache and reads storage directly, correctly reports the slot as free. Two
views of the same room disagreeing. The cost today is smaller but real: decoupling a change
that never comes is complexity paid for anyway, and anyone reasoning about read consistency
opens three files to learn that the answer is "there is no caching."

### Smell 3

**The smell.** God class.

**Classic or agent-specific.** Classic. None of the five agent patterns fits: nothing is
duplicated, over-abstracted, off-convention, inert, or over-commented. This is what a class
becomes when every capability gets one more method, and the lecture's `git log` version of it
would show commits about pricing, email, and date formatting in one file (divergent change).

**Where in the code.** `src/reservationManager.ts`, the `ReservationManager` class; sharpest
at `dispatchNotification` and `formatReceipt`. It is the lecture's `BookingManager`: it owns
the room registry (lines 44-54), booking and cancellation policy (57-111), overlap detection
(160-173), pricing (140-158), notification dispatch and its log (215-218), and
customer-facing presentation (176-208, `formatReceipt` and `formatDailySummary`, plus
`formatClock` and `formatMoney` at 220-227). Ask what the class is for and the answer needs
six clauses. The constructor (lines 40-41) adds the second problem: the notifier and cache
are built inside it from a module-level registry that `registerChannel` mutates at import
time, so they are dependencies the signature never mentions. `storage`, which is injected, is
not the problem; an explicit dependency is the fix, not the smell.

**The principle it violates.** Cohesion (one class, one job); secondarily hidden dependencies
(controllability).

**What it makes expensive.** Two concrete changes. First, presentation is load-bearing on
delivery: `dispatchNotification` sends `formatReceipt(booking)` as the email body (line 216),
so a cosmetic receipt tweak, adding room capacity to a printed receipt say, silently changes
what every organizer receives. There is no seam at which one can change without the other.
Second, adding SMS means constructing a manager with a different channel, and the constructor
takes no notifier, so it cannot be done from outside the class. That blocks testing too:
nothing can assert on delivery except the three colon-joined strings `recentNotifications()`
returns, and `EmailChannel.sentMessages()` is unreachable through the `NotificationChannel`
type.

---

## Milestone 2: One small fix

One fix, behavior preserved, suite green, zero test edits.

**Which smell you attacked.** Smell 1, duplication over reuse in `ReportGenerator`. Two
reasons over the other two. It is the only one of the three already producing wrong numbers
today rather than only threatening a future change, and its fix is a deletion: the duplicate
does not need to be unified with the original, because `ReservationManager` already computes
the price and stores it on the booking. Smell 2's honest fix deletes a whole subsystem and
Smell 3's is a decomposition, so neither is the smallest change.

**What changed.** One file, `src/reportGenerator.ts`. `revenue()` now reads
`booking.priceCents`, the price the booking was actually charged, instead of calling
`this.priceOf(room, booking)` to derive it again. With the last caller gone, `priceOf` and its
helper `durationOf` are deleted, along with the five duplicated constants
(`PREMIUM_RATE_MULTIPLIER`, `LONG_BOOKING_CUTOFF`, `LONG_BOOKING_RATE_MULTIPLIER`,
`EVENING_CUTOFF`, `EVENING_RATE_MULTIPLIER`) and the now-unused `Booking` import. Net 29
lines removed, 3 added. The pricing rule now has exactly one home,
`ReservationManager.calculatePrice`/`applyDiscounts`, and reports read the result instead of
recomputing it.

**What you deliberately did not touch.** The scope line: one rule, one owner. The change ends
when the pricing rule has exactly one home, and everything adjacent to it is either a
behavior change or a different rule.

Three things sit just past that line. First, `revenue()` still looks the room up and skips the
booking when `room === undefined` (lines 67-70), even though `room` is now used for nothing
but that check. Dropping unregistered rooms from revenue is a defect I named in Milestone 1,
but removing the guard would change what the method reports, and this fix is supposed to
preserve behavior. It is a separate fix with a separate argument. Second, I left
`availability.freeMinutes` unused and `occupancy`'s inline window-clamping (lines 39-42) in
place, which is the same smell one level down but a different rule; folding it in would widen
the diff past the one rule I came for. Third, Smells 2 and 3 are untouched.

**How you know behavior is preserved.** `npm test` is 39 tests across 3 files, green before
the change and green after; `npm run typecheck` (`tsc --noEmit`, with `strict` and
`noUnusedLocals`) exits 0; `git status` shows `src/reportGenerator.ts` as the only source file
modified and no test edited.

What the suite actually covers here: `reporting.test.ts:36` pins `revenue().totalCents` to
`morning.priceCents + evening.priceCents`, which is precisely the equivalence this change
relies on, and `:37`, `:38` and `:48` pin the average, the per-room split, and the exclusion
of cancelled bookings to exact cents. `booking.test.ts:95-115` pins all four pricing paths
(flat 12000, long-booking 16200, premium 18400, evening 11400) on the implementation that is
now the only one, so the surviving copy is well nailed down.

What it would not catch: no test runs a revenue report over a premium room, since every
booking in `reporting.test.ts` uses `r1`. The premium branch of the deleted `priceOf` was
therefore never exercised through `revenue()`, and my confidence that it agreed with
`calculatePrice` comes from reading the two, not from the suite. Nothing covers a booking
whose room is missing from the `rooms` array either, so the guard I kept is untested in both
directions. And the case this change actually fixes, a room re-registered at a new rate after
its bookings exist, has no test at all: the suite would not have caught the old behavior and
does not pin the new one.

---

## Milestone 3: Two proposals and one false positive

One proposal for each milestone 1 smell you did not fix.
### Proposal A (not coded)

*Smell 2, the phantom cache.*

**The problem.** Phantom complexity. `src/cache/` is 79 lines of TTL, eviction, and an enable
flag serving one call site that only ever reads. Nothing calls `set`, so the cache cannot
hold anything, and nothing calls `invalidate`, so if it ever did it would have no way to
learn that a booking changed.

**The decomposition.** Two steps, and the first one is subtraction.

Step one, now: delete `src/cache/` and the three lines in `listBookingsForRoom` that consult
it. The pieces afterwards are the ones that already exist, minus two files. `StorageProvider`
owns reads and writes; `ReservationManager` calls it; there is no caching concept, so there is
no invalidation rule to get wrong and nothing for a reader to work out. This is the whole
proposal unless someone produces a measurement.

Step two, only if a measurement demands it: reintroduce caching as a decorator on the seam
that already exists, not as a field on the manager.

- **`StorageProvider`** — unchanged. It is already the right interface, and it is why this
  works without touching any caller.
- **`InMemoryStorageProvider`** — storage only. Knows nothing about caching.
- **`CachingStorageProvider implements StorageProvider`** — wraps another provider and owns
  the entire cache lifecycle: it populates on read, and it drops `bookings:${roomId}` inside
  `save`, `update`, and `clear`. It owns the TTL and the eviction policy.
- **`ReservationManager`** — holds a `StorageProvider` and does not know whether it is
  cached. Whether caching happens becomes a construction-time decision, like `storage`
  already is.

Where the rules live is the point of the move: **invalidation belongs to whatever sees the
writes.** Today it cannot work at any price, because the manager reads the cache and writes
`this.storage`, so no write ever passes the object holding the map. A decorator sits where
both go through, so "a write to room R invalidates room R" is enforceable rather than a
convention someone has to remember at each new call site.

**One cost.** A decorator caches a *method*, and `findByRoom` serves two callers with opposite
needs. `formatDailySummary` can tolerate a slightly stale list. The conflict scan in
`createBooking` (line 68) cannot: serve that one from a stale list and the service confirms a
double booking, turning a performance feature into a correctness bug, in the one method whose
entire job is refusing that. `StorageProvider` has no vocabulary for the difference, so
either the interface grows a freshness flag, which widens it for `InMemoryStorageProvider`
too, and a boolean parameter at that, or the conflict check reaches past the decorator to the
inner provider, which is the same shape as one path skipping the gate that every other path
goes through. There is a second cost at the same seam: a TTL makes reads depend on the clock,
so `Date.now()` becomes a hidden input to the read path and the module stops being
deterministic under test unless a clock is injected as well. That is three new decisions
bought with a benefit nobody has measured, which is why step one is the proposal and step two
is a contingency.

### Proposal B (not coded)

*Smell 3, the god class.*

**The problem.** Cohesion. `ReservationManager` owns six jobs, and one pair of them is
actively entangled: `dispatchNotification` sends `formatReceipt(booking)` as the email body,
so the printed receipt and the outgoing email are the same string by construction, and a
change meant for one silently lands on the other.

**The decomposition.** Carve by responsibility, the way the lecture splits `BookingManager`.

- **`RoomRegistry`** — the `Map<string, Room>` and `register`/`get`/`list`. The only place a
  room is looked up; today `rooms.get` appears in `createBooking`, `formatReceipt`, and
  `formatDailySummary`.
- **`pricing`** — `priceFor(room, start, end)` and the five multipliers. Milestone 2 already
  made this the single home for the rule; this step gives it a name and a file.
- **`BookingService`** — the lifecycle and the no-double-booking invariant: validate,
  conflict-check, price, persist, announce. Owns `hasConflict`. Formats nothing.
- **`BookingFormatter`** — pure functions, data in and string out: `receipt`, `dailySummary`,
  `clock`, `money`. Holds no state and reaches no storage, so it is testable by calling it.
- **`NotificationChannel`** — unchanged, and already correct. Delivery only.

| Piece | Owns | Does not |
| --- | --- | --- |
| `BookingService` | the invariant, and when a booking changes | know what any of it looks like |
| `BookingFormatter` | wording and layout | decide when anything is sent |
| `NotificationChannel` | delivery and its log | compose what it delivers |

The seam that matters is the last row. `BookingService` announces a fact, "this booking was
confirmed," and something small on the notification side decides what the email says by
asking the formatter for a *notification body*, which is a separate string from the *printed
receipt* even on the day the two read identically. Rules end up where they can vary
independently: booking rules stay in `validation.ts`, which is already separate and already
fine; the invariant lives with the only writer; wording lives in the formatter; delivery lives
in the channel.

**One cost.** The split buys the receipt and the email their independence by making them two
templates, and two templates drift. Any change genuinely meant for both, a room's building
code added to the header, say, now has to be made twice, and nothing fails when only one gets
it. That is the trade in plain terms: the coupling defect is exchanged for a duplication risk,
which is the smell I spent Milestone 2 removing from `ReportGenerator`, reappearing one floor
up. Two smaller costs come with it. Following a single booking from request to email goes from
one readable method to four files, and the lecture is explicit that a method coordinating a
use case in a few steps is one to leave alone. And every test pays: `newService()` in
`fixtures.ts` is three lines today, and with a registry, a formatter, and a channel to wire it
becomes a block that every test carries. For a 750-line module with one channel and one
storage backend, five types where there was one is close to the over-abstraction the same
lecture warns about, so the notification seam is the part that earns its keep today. The rest
is worth doing when a second reason to change actually shows up.

### The thing that looks smelly but is fine

**What it is.** `src/validation.ts`, `validateReservationRequest`. Sixty lines, eight `if`
blocks in a row, each returning a different string. It reads like a long method, and a linter
that counts branches would flag it.

**Why it is fine.** It is a pure function of `(request, room)`: no storage, no clock, no
globals, no field of any object it belongs to. Every branch is one condition and one message,
nothing nests, and no state is carried between branches except `durationMinutes`, which is
computed two lines before it is read. The sequence is not arbitrary either. Shape is checked
before meaning, so `Number.isInteger` having passed is what lets every later rule compare
numbers without re-checking them; reordering the blocks would change which message a bad
request gets, which is the one contract the function promises, "return on the first problem so
the caller can report one clear reason." Being flat is also what makes it testable in one
line per rule: `validation.test.ts:17-37` drives fourteen rejection paths through a single
table with one entry point, which is only possible because each rule is reachable by varying
one field. Splitting it into `validateShape`, `validateTimes`, and `validateCapacity` would
add three call sites and remove no branch. There would be the same eight decisions, in the
same order, spread across four places, with the first-problem-wins contract now stitched
across them.

**What would flip your verdict.** Any of three changes, each of which breaks a property the
defense rests on. If a rule has to vary by room or building, opening hours being the obvious
one, the constants stop being constants and the flat function becomes hard-coded policy in a
place that cannot be configured. If a caller needs every failure at once rather than the
first, a form that highlights all its bad fields, the early returns have to become
accumulation, and at that point the shape is genuinely wrong. And if any rule ever needs
something outside `(request, room)`, the current time, the organizer's role, the other
bookings in the room, the function stops being pure, the signature stops telling the truth,
and it turns into the hidden dependency it is careful not to be today.
