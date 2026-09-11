import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ToastProvider } from "@wi/ui";

import { App } from "./App.js";
import "./index.css";

const container = document.getElementById("root");
if (container === null) {
  // Failing loudly beats rendering nothing and leaving a blank page to debug.
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
