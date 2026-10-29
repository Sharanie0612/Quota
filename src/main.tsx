import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UsageWidget } from './components/UsageWidget';
import "./styles.css";
import "./polish.css";
import './glass.css';
import { initializeAppearance } from './lib/appearance';
import { SetupView } from './views/SetupView';
import {GlassFilters} from './components/GlassFilters';

initializeAppearance();


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><GlassFilters/>{new URLSearchParams(location.search).get('window')==='setup'?<SetupView/>:new URLSearchParams(location.search).get('window')==='usage-widget'?<UsageWidget/>:<App />}</React.StrictMode>,
);
