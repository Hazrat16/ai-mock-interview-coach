import { ChartLine, History, LayoutDashboard, Mic, Settings as SettingsIcon } from 'lucide-react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router';
import { cn } from '@/lib/utils';
import { Dashboard } from '@/pages/Dashboard';
import { History as HistoryPage } from '@/pages/History';
import { Interview } from '@/pages/Interview';
import { NewInterview } from '@/pages/NewInterview';
import { Progress } from '@/pages/Progress';
import { Report } from '@/pages/Report';
import { Settings } from '@/pages/Settings';

const nav = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, page: <Dashboard /> },
  { to: '/interview/new', label: 'New interview', Icon: Mic, page: <NewInterview /> },
  { to: '/history', label: 'History', Icon: History, page: <HistoryPage /> },
  { to: '/progress', label: 'Progress', Icon: ChartLine, page: <Progress /> },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon, page: <Settings /> },
];

function ComingSoon({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Arrives in milestone {milestone}.</p>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-svh">
        <nav aria-label="Main" className="w-56 shrink-0 border-r bg-sidebar p-3">
          <p className="px-3 py-2 font-semibold">Interview Coach</p>
          <ul className="mt-2 space-y-1">
            {nav.map(({ to, label, Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent',
                      isActive && 'bg-sidebar-accent font-medium',
                    )
                  }
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 p-8">
          <Routes>
            {nav.map(({ to, page }) => (
              <Route key={to} path={to} element={page} />
            ))}
            <Route path="/interview/:id" element={<Interview />} />
            <Route path="/interview/:id/report" element={<Report />} />
            <Route path="*" element={<ComingSoon title="Page not found" milestone="—" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
