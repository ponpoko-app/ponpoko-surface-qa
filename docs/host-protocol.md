# How QA talks to Ponpoko and to its own backend

The page never imports Tauri and never holds a provider key. Everything it needs arrives through two
narrow doors: the `ponpoko.surface.v1` broker provided by the Host, and the surface's own backend
process, which the Host starts and speaks JSON-RPC 2.0 with over stdin/stdout.

## The page side

`src/bridge/broker.ts` posts `ponpoko.surface.ready` with the `view` token from the URL, waits for
`ponpoko.host.hello`, refuses a protocol other than `1`, and then sends requests of the shape
`{ channel, view, request_id, namespace, operation, payload }`. Every backend call is:

```text
namespace: host.surface
operation: backend.call
payload:   { method, params }
```

The palette arrives as `ponpoko.host.palette` and is applied to `--color-*` custom properties.

The Host AI bridge is injected as `window.ponpoko.ai` (contract version 1). `src/vision/judge.ts`
sends one `invoke` with an image part and a text part, then reads `status(request_id)` until text
comes back, and parses one JSON object out of the answer. A reply that cannot be parsed, times out,
or carries no judgement becomes `unmeasured`.

## The backend side

`backend/main.ts` composes four parts with `mergeRegistries`; a duplicate method name throws at
startup rather than silently winning.

| Group | Methods |
| --- | --- |
| hands | `qa.targets`, `qa.probe`, `qa.capture`, `qa.ax`, `qa.act` |
| store | `qa.project.list`, `qa.project.open`, `qa.project.save`, `qa.cases.read`, `qa.cases.write`, `qa.cases.draft`, `qa.baseline.get`, `qa.baseline.put`, `qa.run.record`, `qa.run.list` |
| pi | `qa.pi.status`, `qa.pi.check`, `qa.pi.update`, `qa.pi.ask` |
| identity | `app.info` |

`app.info` answers the protocol, the surface identity, the pi version compiled into this binary and
the data directory in use. The page refuses to render the stepper when the backend answers a
protocol it does not speak.

`qa.pi.ask` runs `createAgentSession` from the embedded SDK with an in-memory session manager, sends
one prompt, and returns the model name, the active tool names and the text, or an error. It is the
door a later round will use to draft steps that click and type instead of only looking.

## Where the files came from

`ai-contract.json`, `host-ai.mjs` and `host-ai.d.ts` are the generated Host AI assets, copied from
the sibling `ponpoko-surface-chat` checkout at the same Host version (contract 1,
`schema_sha256` unchanged). They are not edited here; regenerate them from the Host when the
contract version moves. `ai-requests.json` carries one safe representative request for the
surface's real workflow: an image and a question, answered with text.

## Failure the user sees

- no `view` token — the page says it was opened outside Ponpoko
- hello timeout — says Ponpoko did not answer, and how to restart it
- a protocol mismatch — says both numbers
- a backend failure — names the method that failed, because the message comes from the backend
