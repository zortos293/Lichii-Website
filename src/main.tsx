import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Link } from './navigation.tsx';
import { TrackingBoundary } from './analytics.tsx';
import '@fontsource/inter-tight/400.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/inter-tight/600.css';
import '@fontsource/inter-tight/700.css';
import '@fontsource/inter-tight/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { Layout } from './components.tsx';
import { Catalog, GameDetail } from './catalog.tsx';
import { SubmitReport } from './submit.tsx';
import { PublicReportPage, RecentReports, Submitted } from './reports.tsx';
import { Guide, Privacy } from './guide.tsx';
import { DesktopGuide } from './desktop-guide.tsx';
import { Maintainer } from './maintainer.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Application root missing');
createRoot(root).render(<StrictMode><BrowserRouter><TrackingBoundary><Layout><Routes>
  <Route path="/" element={<Catalog />} />
  <Route path="/games/:slug" element={<GameDetail />} />
  <Route path="/submit" element={<SubmitReport />} />
  <Route path="/submitted/:id" element={<Submitted />} />
  <Route path="/reports" element={<RecentReports />} />
  <Route path="/reports/:id" element={<PublicReportPage />} />
  <Route path="/guide" element={<Guide />} />
  <Route path="/guide/desktop" element={<DesktopGuide />} />
  <Route path="/privacy" element={<Privacy />} />
  <Route path="/maintainer" element={<Maintainer />} />
  <Route path="*" element={<div className="empty"><h1>Page not found</h1><p>This page may have moved.</p><Link className="button" to="/">Back to games</Link></div>} />
</Routes></Layout></TrackingBoundary></BrowserRouter></StrictMode>);
