import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { installGlobalErrorHandlers } from "./lib/errorReporter";

// Uncaught errors and unhandled promise rejections are reported to the gateway (web.client_error).
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
