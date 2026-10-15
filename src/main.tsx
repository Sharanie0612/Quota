import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UsageWidget } from './components/UsageWidget';
import "./styles.css";


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{new URLSearchParams(location.search).get('window')==='usage-widget'?<UsageWidget/>:<App />}</React.StrictMode>,
);
