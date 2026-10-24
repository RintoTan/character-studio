import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Mantine first: our tokens (and the bridge in ui/tokens.css) have to win the cascade.
import "@mantine/core/styles.css";
import "./styles.css";
import "./ui/tokens.css";
import { MantineRoot } from "./ui/MantineRoot";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineRoot>
      <App />
    </MantineRoot>
  </React.StrictMode>,
);
