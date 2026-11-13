import { useEffect, useMemo, type Dispatch } from "react";
import type { VisionJudge } from "../../contracts/qa";
import { createVisionJudge } from "../../vision/judge";
import { hostPort, type Host } from "../host";
import type { QaAction } from "../state";
import { createRunController } from "./loop";

const unjudged: VisionJudge = {
  judge: async () => ({ verdict: "unsure", confidence: 0, quote: "", visible_text: [], findings: [], error: "Host AI is unavailable; visual evidence remains unmeasured" }),
};

export function useRunController(host: Host, dispatch: Dispatch<QaAction>) {
  const controller = useMemo(() => createRunController({ port: hostPort(host), judge: host.ai === null ? unjudged : createVisionJudge(host.ai) }), [host]);
  useEffect(() => {
    const unsubscribe = controller.subscribe(event => {
      if (event.type === "step_finished") dispatch({ type: "step", result: event.result });
      if (event.type === "run_finished") dispatch({ type: "record", record: event.record });
      if (["run_finished", "run_paused", "run_stopped", "run_failed"].includes(event.type)) dispatch({ type: "running", running: false });
    });
    return () => { controller.stop(); unsubscribe(); };
  }, [controller, dispatch]);
  return controller;
}
