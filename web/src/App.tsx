import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router';
import { Sidebar } from '@/components/layout/Sidebar';
import { Companies } from '@/pages/Companies';
import { Dashboard } from '@/pages/Dashboard';
import { Documents } from '@/pages/Documents';
import { History as HistoryPage } from '@/pages/History';
import { Interview } from '@/pages/Interview';
import { NewInterview } from '@/pages/NewInterview';
import { Progress } from '@/pages/Progress';
import { Report } from '@/pages/Report';
import { Settings } from '@/pages/Settings';

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Dashboard'],
  [/^\/interview\/new$/, 'New interview'],
  [/^\/interview\/[^/]+\/report$/, 'Report'],
  [/^\/interview\/[^/]+$/, 'Interview'],
  [/^\/history/, 'History'],
  [/^\/progress/, 'Progress'],
  [/^\/documents/, 'Documents'],
  [/^\/companies/, 'Companies'],
  [/^\/settings/, 'Settings'],
];

/** The browser tab (and window, in app mode) names the page; each page starts at the top. */
function PageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = title ? `${title} · Interview Coach` : 'Interview Coach';
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Page not found</h1>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <PageTitle />
      <div className="flex min-h-svh">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/interview/new" element={<NewInterview />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/companies" element={<Companies />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/interview/:id" element={<Interview />} />
            <Route path="/interview/:id/report" element={<Report />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
