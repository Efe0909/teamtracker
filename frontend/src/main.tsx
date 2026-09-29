import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./tokens.css";
import "./base.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root yok");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
