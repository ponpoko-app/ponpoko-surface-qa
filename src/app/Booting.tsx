export function Booting({ detail }: { detail: string }): React.ReactElement {
  return (
    <main className="unavailable" aria-busy="true">
      <div className="state-message">
        <span className="wait-mark" aria-hidden="true">↻</span>
        <h1>QA</h1>
        <p className="detail">{detail}</p>
        <p className="recovery">หน้านี้จะไม่ว่างเปล่าแม้ระหว่างรอ. ถ้า Ponpoko ไม่ตอบภายในไม่กี่วินาที จะบอกว่าทำไม</p>
      </div>
    </main>
  );
}
