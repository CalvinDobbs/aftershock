# Aftershock — design system

Extracted from the Claude Design source at `design/Aftershock Bot.dc.html`
(project `cd1054c8`, turn 2: *"Aftershock — the cast in one thread"*).

This file is the contract between the design and `apps/web`. Tokens live in
[`apps/web/app/globals.css`](apps/web/app/globals.css); the bot roster lives in
[`apps/web/components/bots/registry.ts`](apps/web/components/bots/registry.ts).

---

## The idea

A run is a **thread every bot is in**. Not a dashboard with an agent grid — a
room. Each pipeline stage is a character with a name, a face and a job, and the
run is the conversation between them. Evidence is posted as attachments the way
a colleague would paste a screenshot.

This is load-bearing for the pitch, not decoration. A judge watching a grid of
tiles sees "parallel browsers". A judge watching Doppler say *"same clicks on
both sides, main prints $84.00 and Maya's branch prints $8400, nobody claimed
formatPrice would change"* understands the differential oracle without
narration.

Three layouts exist in the source:

| Ref | Name | Where it lives in the app |
| --- | --- | --- |
| 2a | The run, as a thread every bot is in | `/runs/[runId]` — rail + thread |
| 2b | A handoff, close up | the `Handoff` divider inside the thread |
| 2c | Six sessions at once | the browsers row, inline in the thread |

Two departures from the source, both simplifications:

- **No right-hand issue rail.** It reserved a third of the screen for an
  artefact that does not exist for most of a run. Gavel posts the issue into
  the thread when it files it, and the fix checklist ticks in place as the
  Cast re-runs — one object, not two views of it.
- **No separate Browsers view.** The sessions are the most persuasive thing
  the product does, so they sit in the conversation rather than a click away.

---

## The cast

The design draws **eleven** bots. Aftershock ships **six** in the rail.
Three cuts follow the PRD's own pre-agreed cut order (*Scope > The cut order*)
rather than taste; Maestro and Encore are demoted rather than cut, because
neither is a distinct agent behind the scenes.

| Bot | Role | PRD stage | Fill | Face ink | Period |
| --- | --- | --- | --- | --- | --- |
| Diffany | turns the diff into claims | Scout | `#d6a13c` | `#3d2c0c` | 7.2s |
| QAizen | checks a claim start to finish | Cast · conformance | `#4fae7a` | `#0f2e1e` | 6.1s |
| Doppler | runs your branch against main | Cast · differential | `#5b8fd6` | `#12243a` | 7.7s |
| Gavel | the only one allowed to file | Critic | `#d6604f` | `#3d1410` | 8.8s |
| Clueso | reads the log, then the code | Sleuth | `#4f9fd6` | `#0e2439` | 7s |
| Patchouli | writes the smallest patch | Understudy | `#68b55f` | `#0f2c0c` | 7.9s |

### Demoted

**Maestro** (`#8a8a8a` / `#2a2a2a` / 9.4s) is the Director, which is
deterministic code rather than an agent. It speaks as the room's centred
system lines and still appears as the avatar on a failed run, but it holds no
rail row — a roster is a list of things you can be waiting on, and the
Director is never what you are waiting for.

**Encore** was Curtain Call, and the PRD's own cast table gives its model as
*"reuses the Cast"* — it was never a separate agent, model or runner, just the
same Actions replayed against the fix preview. So QAizen and Doppler report
their own re-runs. The closing beat is better for it: the bot that found the
bug is the one that says it is gone.

### Cut

| Bot | Was | Why cut |
| --- | --- | --- |
| Havoc | adversary agents, hostile inputs | Cut order #1. P2 in the PRD. |
| Wanda | explorer agents, no script | Cut order #3. P1, and explorer findings cannot file an issue on their own anyway — they must be promoted by a conformance or differential re-run, so the room can tell that story without a seat at the table. |
| Nitpick | a second Cast member for edge cases | Redundant once Havoc is gone; its work folds into QAizen's conformance assignments. |

Patchouli is drawn **static** in the source because it is still waiting when
the frame was captured. It is given `idle`/`grin` faces in the same idiom so
it animates once it has work.

**Hovering a bot makes it react.** Each face carries its ambient period in a
`--face-dur` custom property; hover drops that to 1.1s so the grin lands
within a second instead of whenever it was next due. One animation per face,
driven by one property — no second keyframe.

---

## Faces

Every avatar is a 40×40 viewBox: a filled circle plus **two stacked `<g>`
groups** that cross-fade on one timeline.

```
@keyframes idle { 0%,84%,100% { opacity: 1 } 88%,96% { opacity: 0 } }
@keyframes grin { 0%,84%,100% { opacity: 0 } 88%,96% { opacity: 1 } }
```

So the resting expression holds for ~84% of the cycle and the grin flashes
twice, briefly. Each bot carries its own period (6.1s–9.4s, all coprime-ish) so
the room never blinks in unison — that desync is what makes eight faces read as
eight characters instead of one animation.

Resting expressions are abstract and job-shaped: Diffany is a triangle (a diff
marker), QAizen three bars (assertions in a row), Doppler two rings (two
sessions), Clueso a magnifier, Gavel a hammer.
Grins are always eyes-plus-mouth. Clueso's grin winks.

Avatars render **unanimated** in dense contexts — past runs in the rail,
inline handoff chips, attachment headers — and animated where a bot is
present: the roster and message gutters. A waiting bot keeps blinking; freezing
its face reads as the room being switched off, so waiting is carried by opacity
and a status dot instead.

Each rail row carries a **status line** in the bot's own voice — *is reading
the diff*, *is cooking*, *A1 · step 4*. A stage that takes twenty seconds then
reads as someone working rather than as a spinner.

---

## Colour

Surfaces, darkest to lightest. Depth comes from stacking flat greys, never from
borders or shadows on interior elements.

| Token | Hex | Use |
| --- | --- | --- |
| `page` | `#0b0b0b` | document |
| `shot` | `#0d0d0d` | browser-frame body, code blocks |
| `rail` | `#101010` | left sidebar |
| `rail-2` | `#111111` | right issue rail |
| `stage` | `#141414` | the thread column, card background |
| `sunk` | `#171717` | memory notes |
| `card` | `#181818` | attachment cards, rail cards |
| `card-2` | `#1a1a1a` | evidence wells, search field |
| `composer` | `#1c1c1c` | the composer pill |
| `bubble` | `#1e1e1e` | message bubbles, active sidebar row |
| `chip` | `#242424` | pills and buttons |

Hairlines: `#1c1c1c`, `#232323` (chrome), `#2e2e2e` dashed (a card for
something that has not happened yet).

**Two accents, and they mean different things.**

| Token | Hex | Means |
| --- | --- | --- |
| `amber` | `#e8a33d` | *working* — live dots, spinners, progress, links |
| `flare` | `#d2411f` | *look here* — 1.5px outline on the frame that shows the bug |
| `alarm` | `#f0674a` | failure text |

Amber never marks a failure and vermilion never marks activity. That separation
is why a screenshot with a `flare` outline reads instantly.

Text runs a nine-step grey ramp from `#f0f0f0` down to `#8a8a8a`. Message body
is `#e4e4e4` at 15px/1.55; secondary prose `#9a9a9a`; metadata `#909090`.

`@mentions` are tinted with the mentioned bot's own `say` colour — QAizen green
`#7fd3a3`, Doppler blue `#8fb4e8`. This is how the transcript stays readable
when five bots are talking.

Diff lines: removed `#c98b7a`, added `#7fd3a3`.

---

## Type

| Role | Stack | Sizes |
| --- | --- | --- |
| Prose | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui` | 15/1.55 body · 14 names · 12.5 secondary · 11.5 meta |
| Machine | IBM Plex Mono 400/500 | 13 inline · 12 values · 11 captions · 10.5 labels |

Mono is reserved for things a machine produced or a machine reads: SHAs,
session IDs, routes, selectors, prices, confidence numbers, file:line, diffs,
reproduction steps. Prose is for anything a bot *says*. The split is strict —
it is what keeps the room from looking like a chat toy.

Section labels in the rails are 11px/500, `letter-spacing: .05em`, uppercase,
`#909090`.

---

## Shape and rhythm

| Element | Radius |
| --- | --- |
| Message bubble | 14px |
| Attachment / rail card | 13–14px |
| Evidence well, sidebar row | 11–12px |
| Browser frame | 8–9px |
| Pills, composer | 999px |
| In-page mock elements | 3–7px |

Avatar sizes: 38 (sidebar run rows) · 30 (message gutter) · 26 (header, roster)
· 24 (browser cards) · 22 (handoff chips) · 17 (attachment headers, inline).

Message gutter gap is 11px. Thread gap is 17px. Bubbles cap at 520–680px so
lines stay readable on a wide screen — the column does not stretch.

---

## The browser frame

The single most repeated component. Dark chrome — three 6–7px `#3a3a3a` dots
and a mono URL chip on `#232323` — wrapping a **white** page render.

That white is deliberate and it is the whole trick: the app under test is a
bright consumer storefront, so every screenshot is a bright rectangle in a dark
room. Evidence draws the eye without any highlight at all.

States:

- **Finished** — grey dot + "Finished" pill.
- **Working** — amber ring spinner + "Working" pill, a `REC 0:19` blinking
  vermilion dot in the chrome, and a `swp` scanline drifting down the page body
  every 3s. An amber cursor arrow sits where the agent is about to click.
- **Flagged** — `outline: 1.5px solid #d2411f`, and the value in dispute is
  restated in `flare` inside the page render.

Paired panes (Doppler) are two frames side by side, labelled `MAIN` and
`FEAT/COUPONS` in 10.5px mono, with only the preview side outlined.

Screenshot strips under a card are 22px `#242424` blocks that warm to `#3a2a18`
then `#4a2018` as the run approaches the failing step.

---

## Layout

```
┌─ 288px ─────────┬──────────── flex ─────────────────┐
│ rail   #101010  │ run header                        │
│                 ├───────────────────────────────────┤
│ RUNS            │   thread · max 820, centred       │
│  4 recent       │    ── system line ──              │
│                 │    [bot] message + attachments    │
│ IN THE ROOM     │    ┌────────┬────────┬────────┐   │
│  ● Diffany      │    │ 16:10  │ 16:10  │ 16:10  │   │
│    6 assertions │    └────────┴────────┴────────┘   │
│  ● QAizen       │    ── handoff ──                  │
│    A1 · step 4  │    [bot] is cooking…              │
│  ○ Gavel        │                                   │
│    waiting      │   composer                        │
│ BROWSER BUDGET  │                                   │
│ user            │                                   │
└─────────────────┴───────────────────────────────────┘
```

The column caps at 1080px; speech bubbles inside it cap at 760px. Prose past
roughly 80 characters a line stops being readable however wide the window is,
but evidence wants the room, so the two are capped separately.

Browsers run **two abreast**, not three. At three the storefront inside each
frame stops being legible, and an unreadable browser proves nothing.

The rail collapses to a 60px column that keeps the faces and their status
dots. A rail that hid them to save 230px would have thrown away the only thing
it was for. **Runs** and **In the room** each minimise independently, and the
choice persists.

**Evidence appears once.** The browsers row carries the recordings; the message
that follows carries the argument as values (`$84.00 → $84.00, should read
$67.20`) rather than repeating the same frames as screenshots. Saying it twice
doubles the height of every finding and makes neither copy land.

Attribution is the confidence model made visual — Diffany cites the diff for
what should happen, QAizen reports what did, and only Gavel decides it counts.
You can see that no single agent both found the bug and judged it.

---

## Motion

Seven keyframes total. Nothing else moves.

| Name | Use |
| --- | --- |
| `idle` / `grin` | bot faces, cross-faded, per-bot period |
| `bl` | live dots, typing carets, `REC` indicator — 1.4s, or 1s step-end for a text caret |
| `sp` | 1s linear ring spinner inside "Working" pills |
| `swp` | recording scanline, 3s linear, `translateY(-130% → 1100%)` |
| `land` | new thread entries rise 8px and fade in over 360ms |
| `reveal` | media develops in: cross-fade under a 1.5% scale settle, 460ms |
| `breathe` | the placeholder under unloaded media — deliberately not a sweep |

Typing dots are three `bl` spans offset 0.18s apart — the only staggered
animation in the system, because it is the one place the stagger *is* the
meaning.

Media never pops. A recording reveals on its first **decoded** frame, not on
attach; attaching only means the request went out, and showing the element
then gives a black flash. The 16:10 box is the same height before and after,
so nothing reflows as feeds arrive at different moments.

A full run replays in about a minute. The gap between a stage starting and
completing is where the room shows who is working, so those gaps are long
enough to read the message that just landed and notice the next bot start.

`land` is the only addition to the source, and it exists because the design is
a still frame while the product streams. Everything respects
`prefers-reduced-motion`.

---

## Copy

The bots talk like colleagues, not like tools.

> **Diffany** — "Maya says this adds a coupon field that takes a percentage off
> the total. That's three things she claims are true. I'm also sending someone
> down plain checkout with no coupon — she never mentioned it, which is exactly
> why I want it watched."

> **Gavel** — "@QAizen keeping yours — 3 of 3, and main does the right thing,
> so it's new. @Doppler yours too, 0.79."

Rules that make it work:

- **First person, present tense, no hedging.** "Total does not move", not "It
  appears the total may not have updated."
- **Numbers inline and unrounded.** `$84.00 before, $84.00 after`.
- **Address each other by name.** The handoffs are the pipeline; saying them out
  loud is what makes the multi-agent structure legible.
- **Never narrate confidence as feeling.** Gavel cites the arithmetic.
- **No emoji, no exclamation marks, no apologising.**
