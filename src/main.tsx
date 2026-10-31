import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import {UsageWidget} from './components/UsageWidget';
import {SetupView} from './views/SetupView';
import {initializeAppearance} from './lib/appearance';
import {resolveWindowKind} from './window';
import './styles.css';

const kind=resolveWindowKind(location.search);
initializeAppearance(kind);
const View=kind==='setup'?SetupView:kind==='usage-widget'?UsageWidget:App;
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><View/></React.StrictMode>);
