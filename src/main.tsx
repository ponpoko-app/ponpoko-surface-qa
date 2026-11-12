import { createRoot } from "react-dom/client";
import "./styles/app.css";

const node = document.getElementById("app");

if (!node) throw new Error("the QA surface has no #app element to mount into");

createRoot(node).render(
  <main>
    <h1>QA</h1>
  </main>,
);
