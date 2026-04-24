import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Preferences } from "./Preferences";
import "./palette.css";
import "./preferences.css";

const params = new URLSearchParams(window.location.search);
const view = params.get("view");

document.body.dataset.view = view === "prefs" ? "prefs" : "palette";

const Root = view === "prefs" ? Preferences : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
