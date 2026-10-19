import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { registerAppShell } from './lib/offline/registerPwa'

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
void registerAppShell().catch(() => { /* Online use remains available if installation is blocked. */ });
