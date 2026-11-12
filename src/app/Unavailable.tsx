import type { BootFailure } from "./boot";

export function Unavailable({ failure }: { failure: BootFailure }): React.ReactElement {
  return (
    <main className="unavailable">
      <h1>{failure.title}</h1>
      <p className="detail">{failure.detail}</p>
      <p className="recovery">{failure.recovery}</p>
    </main>
  );
}
