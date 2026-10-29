import { ChartLine, History, LayoutDashboard, Mic, Settings as SettingsIcon } from 'lucide-react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router';
import { cn } from '@/lib/utils';
import { Settings } from '@/pages/Settings';

const nav = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, milestone: 'M10' },
  { to: '/interview/new', label: 'New interview', Icon: Mic, milestone: 'M4' },
  { to: '/history', label: 'History', Icon: History, milestone: 'M10' },
  { to: '/progress', label: 'Progress', Icon: ChartLine, milestone: 'M10' },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
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
            {nav.map(({ to, label, milestone }) => (
              <Route
                key={to}
                path={to}
                element={milestone ? <ComingSoon title={label} milestone={milestone} /> : <Settings />}
              />
            ))}
            <Route path="*" element={<ComingSoon title="Page not found" milestone="—" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
