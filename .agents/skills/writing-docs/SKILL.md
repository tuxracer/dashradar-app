---
name: writing-docs
description: Use when writing or editing anything a person reads - the README, docs/TRD.md, anything else under docs/, code comments, commit messages, PR descriptions, or in-app copy. Holds the voice standards and the length discipline that keep the TRD from bloating.
---

# Writing docs

**Docs are written for humans, and they have to stay that way.** This covers the TRD, the README, and anything else added under `docs/`. Picture a working software engineer who has never seen this codebase and has the source open in the next window. Write for that person, in plain English, reaching for jargon only where the concept genuinely has no plainer name.

The TRD reached 22,000 words of dense paragraphs once and had to be rewritten from scratch. That happens one reasonable-looking addition at a time, so hold the line on every edit.

## The rules

- **Explain, don't transcribe.** Say what a part does and why the non-obvious choices are what they are. The reasoning is the whole value, because it is the only thing not recoverable by reading the code. Skip anything the reader could learn faster by opening the file: what each ref holds, what every branch of a handler does, which fields a type has.
- **Prefer names over values for anything tunable.** A named threshold or interval can be looked up and won't be wrong after someone tunes it. Spell out a number only when it is structurally load-bearing (the scan floor, the model input size, the confidence floor) and the reader can't follow the argument without it.
- **Keep the shape friendly.** Short sections with descriptive headings, a sentence or two of orientation before any list, tables for anything enumerable, and paragraphs that stay under about five lines. If a section needs sub-sub-sections, it wants splitting instead.
- **Say each why once, tightly.** A hard-won rationale earns a sentence or two, never a narrated paragraph; drop walkthroughs and per-field enumerations the reader gets faster from the code. The TRD reads right at about 4,000 words; even a 6,700-word version was judged too verbose.
- **Write for the rendered page.** No `---` horizontal rules (headings already separate sections; the rules draw heavy bars), and diagrams are mermaid fences rather than ASCII art, so GitHub renders a real graphic.
- **Cut before you add.** New material usually means something nearby is now redundant. A section that has slowly turned into a wall is a bug to fix, not a style to match.
- **Read it back as a stranger.** If a paragraph only makes sense to someone who already knows the answer, rewrite it.

## Voice

Plain and direct. No em dashes, no "delve", "seamless", "robust", or "leverage", no adjective triads, no emoji headings, no "In summary" wrap-ups.

The same voice applies to every other surface a person reads: code comments, commit messages, PR descriptions, and in-app copy. Length expectations differ, the plain-English standard doesn't.

## Never point a human at an agent-facing path

README, TRD, code comments, commit messages, PR descriptions, and in-app copy are written for people, and a pointer to the agent instruction file is noise to every one of them: it either sends the reader somewhere that answers a question they didn't ask, or it advertises how the file was written. Same for `.claude/`, `.agents/skills/`, plans under `docs/superpowers/`, and any other agent-facing path.

State the rule where it belongs instead. If the reader needs the commands, they're in the README; if they need a convention, write the convention; if a piece of code is load-bearing for a reason that isn't obvious, say the reason rather than pointing at a list of gotchas.

## Naming the app

It is a computer-vision police detector that spots patrol vehicles on the road in real time. It cannot detect radar, LIDAR, or any RF emission. Never call it a "radar detector" or say it detects radar in user-facing copy; "radar" is only a visual metaphor for the UI.
