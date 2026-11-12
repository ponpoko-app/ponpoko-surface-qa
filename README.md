# QA — a Ponpoko surface that tests real software

QA is a surface for Ponpoko that drives the software already running on this machine: it lists the
real windows, measures what each one exposes, talks to you as a PO, drafts the cases, and then runs
them one visible step at a time — screenshot, verdict, evidence.

It bundles `pi` (`@earendil-works/pi-coding-agent`) inside its own backend binary, so the agent that
thinks about your software ships with the surface and needs no `pi` CLI on the machine.

```sh
bun install --ignore-scripts
bun run typecheck && bun test test && bun run lint
bun run build                     # writes dist/ with bin/qa-backend (pi compiled in)
ponpoko surface-install --bundle dist
```

`surface.json` declares `requires.ai: 1`, so the Host injects `window.ponpoko.ai` and QA can ask an
image model to look at each screenshot. A host that does not inject it still runs every other part;
a step it cannot judge is reported as **unmeasured**, never as passing.

## What it drives

| Part | How |
| --- | --- |
| windows | `CGWindowListCopyWindowInfo` through a small Swift helper, so each target carries its real window id |
| accessibility | `AXUIElement` tree with role, title, value and frame per node |
| capturing | `screencapture -l<window>` with a rect fallback, sized with `sips` |
| acting | `CGEvent` mouse and keyboard, then an `AXUIElementCopyElementAtPosition` hit-test on the same point |
| judging | the image goes to the Host AI with a closed question, and the answer must quote text it can see |

The Swift helper is written to `<data dir>/tools/qa-hands.swift` and compiled with `swiftc` on first
use, then cached. If `swiftc` is missing, the backend says so and reports an unmeasured capability
instead of pretending it looked. macOS needs **Screen Recording** and **Accessibility** for the app
that runs the backend; when they are missing the probe says `denied` or `unknown` and every step is
**unmeasured**.

The probe reports a tier with the measurement behind it, never a guess:

- `S` — a document channel answered (CDP) and this window is one of its targets
- `S-` — an `AXWebArea` gave structure but nothing to drive it
- `A` — a deep labelled accessibility tree
- `B` — a tree too thin to locate by meaning
- `C` — nothing readable, pixels only

## Where your data lives

Nothing about your software is stored in this repository. Projects, cases, baselines and runs live
under `QA_DATA_DIR` (or `PONPOKO_SURFACE_DATA_DIR` when Ponpoko starts the backend, or `~/.piqa` when
you run the backend yourself):

```text
<data dir>/projects/<slug>/project.json        the PO answers and the measured capability
<data dir>/projects/<slug>/cases/TC-001.yaml   the cases, editable as YAML
<data dir>/projects/<slug>/baselines/<case>/   the frames a passing step was accepted against
<data dir>/projects/<slug>/runs/<run>/run.json every step, its verdict and its screenshot
```

A case declares what to do and what to see; a run captures the step, diffs it against the accepted
baseline, asks the eye a closed question about the crop, and classifies the disagreement:

| structural | eyes | verdict |
| --- | --- | --- |
| the element is there | it cannot be seen on screen | `invisible` — a bug, because people use their eyes |
| the element is missing | it is painted anyway | `ghost` |
| both agree | it is there but looks wrong (spacing, clipping, colour) | `visual` |
| either side unmeasured | — | `unmeasured`, never `pass` |

## Checking pi and extensions from the screen

The header carries one panel: the `pi` compiled into this bundle, the `pi` installed on this machine,
and every package in `~/.pi/agent/settings.json` plus every file in `~/.pi/agent/extensions`.

- **ตรวจ registry** reads `https://registry.npmjs.org/<name>/latest` for `pi` and each npm package and
  prints the channel it used. Offline it says `unavailable` with the real error — it never invents a
  version.
- **อัปเดต pi / อัปเดต extensions / อัปเดตทั้งหมด** run `pi update`, `pi update --extensions` or
  `pi update --all` and print the command, the exit code and the output. Nothing runs on its own.
- With no `pi` CLI on the machine the panel says so and refuses, because the pi inside this bundle
  changes only when you install a new bundle.

## Proof

```sh
node scripts/probe-targets.mjs      # the windows this machine really has
node scripts/probe-tier.mjs         # one window's tier, reason and signals
node scripts/pi-status.mjs          # the embedded pi, the machine pi, the extensions
node scripts/pi-status.mjs --check  # the same plus the registry answer
bun run scripts/qa-check.ts         # the diff, yaml, store and stepper laws
```

## What this is not

There is no sandbox. The backend acts as you, with your rights, on whatever window you point it at.
A secure input field cannot be read or typed into by design, an OS permission dialog cannot be
dismissed by the agent, and those steps are yours to press.

The UI chrome follows the Host palette through `--color-*` tokens and falls back to its own when it
is opened without a host.
