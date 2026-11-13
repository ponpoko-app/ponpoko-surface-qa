import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import "./styles/states.css";
import "./styles/cases.css";
import "./styles/data.css";
import { bootQa, type BootFailure } from "./app/boot";
import { Booting } from "./app/Booting";
import type { Host, HostInfo } from "./app/host";
import { Qa } from "./app/Qa";
import { Unavailable } from "./app/Unavailable";

type Booted = { kind: "booting" } | { kind: "ready"; host: Host; info: HostInfo } | { kind: "failed"; failure: BootFailure };

function Surface(): React.ReactElement {
  const [booted, setBooted] = useState<Booted>({ kind: "booting" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await bootQa();
      if (!alive) return;
      setBooted(result.ok ? { kind: "ready", host: result.value.host, info: result.value.info } : { kind: "failed", failure: result.failure });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (booted.kind === "booting") return <Booting detail="กำลังเชื่อมกับ Ponpoko และเปิด backend ของ QA…" />;
  if (booted.kind === "failed") return <Unavailable failure={booted.failure} />;
  return <Qa host={booted.host} info={booted.info} />;
}

const node = document.getElementById("app");
if (!node) throw new Error("the QA surface has no #app element to mount into");
createRoot(node).render(<Surface />);
