/*
 * Bootstraps the React app into the root DOM node with routing, background layout, and background context.
 * Imports global styles and performs the client-side render side effect.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import EndOfLifeNotice from "./components/EndOfLifeNotice";
import "./index.css";
import "./styles/tool-v2.css";
import Layout from "./bg"
import { BgProvider } from "./BgContext";
import { installClientErrorReporter } from "./lib/clientErrorReporter";

installClientErrorReporter("browser");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <EndOfLifeNotice />
      <BgProvider>
        <Layout>
          <App />
        </Layout>
      </BgProvider>
    </BrowserRouter>
  </React.StrictMode>
);
