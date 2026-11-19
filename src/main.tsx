import React from 'react';
import ReactDOM from 'react-dom/client';
import {initializeAppearance} from './lib/appearance';
import {resolveWindowKind} from './window';
import './styles.css';

const kind=resolveWindowKind(location.search);
initializeAppearance(kind);
const windows = {
  main: () => import('./App'),
  'usage-widget': () => import('./components/UsageWidget').then(m => ({ default: m.UsageWidget })),
  setup: () => import('./views/SetupView').then(m => ({ default: m.SetupView })),
};
const View = React.lazy(windows[kind]);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><React.Suspense fallback={null}><View/></React.Suspense></React.StrictMode>,
);
