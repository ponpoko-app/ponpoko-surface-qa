# QA — a Ponpoko surface that tests real software

QA is an app-agnostic surface for Ponpoko: it lists real windows, measures what each target exposes,
talks to you as a PO, and lets you build one case that mixes native GUI, Web DOM, HTTP API, and
command-line steps. Every run keeps its action, measured output, screenshot, and verdict visible.

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
| native acting | `CGEvent` mouse and keyboard, then an `AXUIElementCopyElementAtPosition` hit-test on the same point |
| Web DOM | CDP `Runtime.evaluate` inspection plus real `Input` mouse, text, and key events on the matching page |
| HTTP API | bounded HTTP requests with method, headers, body, timeout, exact status expectation, and response evidence |
| command line | an explicit user-written shell command with cwd, timeout, exit status, and bounded stdout/stderr evidence |
| judging | GUI/Web images go to the Host AI with a closed question; API/CLI steps can pass from measured status and output without AI |

The Swift helper is written to `<data dir>/tools/qa-hands-<source hash>.swift` and compiled with `swiftc` on first
use, then cached. If `swiftc` is missing, the backend says so and reports an unmeasured capability
instead of pretending it looked. macOS needs **Screen Recording** and **Accessibility** for the app
that runs the backend; when they are missing the probe says `denied` or `unknown` and every step is
**unmeasured**.

The Web driver looks for CDP at `http://127.0.0.1:9222` and associates a real page target with the
selected window title. Start the browser with `--remote-debugging-port=9222` to enable it. A missing
or mismatched CDP channel is **unmeasured**, not a GUI click and not a pass. Locators are app-neutral:
CSS selector, DOM role/label, or visible text.

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

## The guided surface

1. **เลือกเป้าหมาย** — choose any real application window and inspect its measured capability.
2. **คุยกับ PO** — describe purpose, critical flows, unacceptable failures, design rules, and test data.
3. **ตรวจ case** — create cases, add/remove/reorder steps, and edit every action from the UI: native
   semantic/text/visual/point locators, Web CSS/semantic/text locators and DOM assertions, or HTTP/CLI
   parameters. Saving is required before the edited plan can run; YAML remains available for editing
   outside the UI and old cases still open as GUI cases.
4. **รันทีละขั้น** — run the entire case or one step, inspect the result, then continue. Stop takes
   effect after the current action and retains completed evidence; continuing uses the same run id.
5. **รายงาน** — review the driver, action detail, structural/output assertion, HTTP/CLI evidence,
   visual findings, screenshot, and verdict for every completed step.

A case declares what to do and what to see. GUI/Web steps use AX or DOM inspection and visual checks;
HTTP/CLI steps use status and output assertions. Steps with no measured channel stay unmeasured.
For GUI/Web, a run captures the step, diffs it against the accepted baseline, asks the eye a closed
question about the image, and classifies the disagreement:

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
bun run scripts/qa-check.ts         # diff, all-driver YAML, UI guidance, HTTP/CLI and run-session laws
```

## What this is not

There is no sandbox. The backend acts as you, with your rights, on whatever window, URL, or command
you point it at. Command steps deliberately run through `/bin/sh -lc`; review them before running.
Timeouts are bounded to 120 seconds and stored text output to 64 KiB. A secure input field cannot be
read or typed into by design, an OS permission dialog cannot be dismissed by the agent, and those
steps are yours to press.

The UI chrome follows the Host palette through `--color-*` tokens and falls back to its own when it
is opened without a host.

## Reproducible checks

`bash scripts/prove-all.sh` runs the local build, tests and run-session proofs without reading
other repositories or controlling open applications. `bash scripts/prove-all.sh --native`
additionally probes this machine and installs the unchanged bundle into an isolated profile.
Set `PONPOKO_CLI` to an installed Ponpoko CLI for that smoke check. Capturing a page is not
visual acceptance or proof of paid inference.

See [the public SDK contract and compatibility checks](docs/sdk.md). Host AI judges screenshots.
The embedded Pi agent uses Pi's own configured accounts for explicit `qa.pi.ask` requests;
those requests do not use the Host AI allowance. No Pi model call is made by the local proof suite.

Native input first verifies and focuses the selected process and window through Accessibility.
A missing, ambiguous or unfocusable window refuses input. Navigation is locked during a run.
A completed action is recorded before Continue can advance; an unknown action outcome blocks
Continue until the target has been inspected and a new run explicitly started.
