import { parse, stringify } from "yaml";
import type { QaCase, QaStep } from "../src/contracts/qa";
import { readCase } from "../src/contracts/readers";

function actionOf(step: QaStep): Record<string, unknown> {
  if (step.action.type === "none") return { type: "none" };
  const action = step.action;
  return {
    type: action.type,
    window_id: action.window_id,
    ...(action.locator === undefined ? {} : { locator: action.locator }),
    ...(action.text === undefined ? {} : { text: action.text }),
    ...(action.keys === undefined ? {} : { keys: action.keys }),
    ...(action.ms === undefined ? {} : { ms: action.ms }),
    ...(action.url === undefined ? {} : { url: action.url }),
    ...(action.method === undefined ? {} : { method: action.method }),
    ...(action.headers === undefined ? {} : { headers: action.headers }),
    ...(action.body === undefined ? {} : { body: action.body }),
    ...(action.expect_status === undefined ? {} : { expect_status: action.expect_status }),
    ...(action.command === undefined ? {} : { command: action.command }),
    ...(action.cwd === undefined ? {} : { cwd: action.cwd }),
    ...(action.timeout_ms === undefined ? {} : { timeout_ms: action.timeout_ms }),
  };
}

function stepOf(step: QaStep): Record<string, unknown> {
  return {
    id: step.id,
    title: step.title,
    actor: step.actor,
    action: actionOf(step),
    see: {
      question: step.see.question,
      must_show: [...step.see.must_show],
      must_not_show: [...step.see.must_not_show],
      mode: step.see.mode,
      ...(step.see.dom === undefined
        ? {}
        : {
            dom: {
              ...(step.see.dom.selector === undefined ? {} : { selector: step.see.dom.selector }),
              ...(step.see.dom.text_contains === undefined ? {} : { text_contains: step.see.dom.text_contains }),
              ...(step.see.dom.visible === undefined ? {} : { visible: step.see.dom.visible }),
            },
          }),
    },
  };
}

export function serializeCase(testCase: QaCase): string {
  return stringify(
    {
      id: testCase.id,
      title: testCase.title,
      priority: testCase.priority,
      intent: testCase.intent,
      preconditions: [...testCase.preconditions],
      created_at: testCase.created_at,
      steps: testCase.steps.map(stepOf),
    },
    { lineWidth: 0 },
  );
}

export function parseCase(text: string): QaCase {
  return readCase(parse(text));
}
