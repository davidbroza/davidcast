import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./palette.css";
import "./preferences.css";

document.body.dataset.view = "palette";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
