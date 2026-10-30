import {
  Building2,
  ChartLine,
  FileText,
  History,
  LayoutDashboard,
  type LucideIcon,
  Mic,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { type Health, healthSchema } from '@shared/schemas/health';
import { getJson } from '@/lib/api';
import { cn } from '@/lib/utils';

type Item = { to: string; label: string; Icon: LucideIcon };

const GROUPS: { name: string; items: Item[] }[] = [
  {
    name: 'Practise',
    items: [
      { to: '/', label: 'Dashboard', Icon: LayoutDashboard },
      { to: '/history', label: 'History', Icon: History },
      { to: '/progress', label: 'Progress', Icon: ChartLine },
    ],
  },
  {
    name: 'Prepare',
    items: [
      { to: '/documents', label: 'Documents', Icon: FileText },
      { to: '/companies', label: 'Companies', Icon: Building2 },
    ],
  },
];

const HEALTH_POLL_MS = 30_000;

function NavItem({ to, label, Icon }: Item) {
  return (
    <NavLink
      to={to}
      end
      title={label}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors',
          'hover:bg-sidebar-accent hover:text-sidebar-foreground',
          'focus-visible:outline-2 focus-visible:outline-sidebar-ring',
          // The current page: a cyan mark on the left.
          isActive &&
            'bg-sidebar-accent font-medium text-sidebar-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="hidden md:inline">{label}</span>
    </NavLink>
  );
}

/** The local AI services at a glance: they are needed for questions, voice and interview-ready answers. */
function ServiceStatus() {
  const [health, setHealth] = useState<Health | null>();
  useEffect(() => {
    let active = true;
    const check = () =>
      getJson('/api/health', healthSchema)
        .then((h) => active && setHealth(h))
        .catch(() => active && setHealth(null));
    void check();
    const t = setInterval(check, HEALTH_POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);
  if (health === undefined) return null;
  const parts = health ? [health.ollama, health.tts, health.stt] : [];
  const down = !health || parts.some((p) => p.status === 'down');
  const degraded = !down && parts.some((p) => p.status === 'degraded');
  const label = down ? 'AI services not running' : degraded ? 'AI services need attention' : 'AI services ready';
  return (
    <Link
      to="/settings"
      title={down ? `${label}: start them with make deps-up` : label}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-xs text-sidebar-foreground/75 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring"
      role="status"
    >
      <span
        aria-hidden
        className={cn(
          'size-2 shrink-0 rounded-full',
          down ? 'bg-destructive' : degraded ? 'bg-amber-500' : 'bg-emerald-500',
        )}
      />
      <span className="hidden md:inline">{label}</span>
      <span className="sr-only md:hidden">{label}</span>
    </Link>
  );
}

/** Stays in place while the page scrolls. Below the md breakpoint it shrinks to icons. */
export function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 flex h-svh w-14 shrink-0 flex-col gap-4 overflow-y-auto bg-sidebar p-2 text-sidebar-foreground md:w-60 md:p-3"
    >
      <Link to="/" className="flex items-center gap-2.5 rounded-md px-2 py-1.5 focus-visible:outline-2">
        <img src="/icon.svg" alt="" className="size-7 shrink-0" />
        <span className="hidden font-semibold tracking-tight md:inline">Interview Coach</span>
        <span className="sr-only md:hidden">Interview Coach</span>
      </Link>

      <NavLink
        to="/interview/new"
        end
        title="New interview"
        className={({ isActive }) =>
          cn(
            'flex items-center justify-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 text-sm font-medium text-sidebar-primary-foreground shadow-xs transition-colors',
            'hover:bg-sidebar-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring',
            isActive && 'ring-2 ring-sidebar-foreground/25',
          )
        }
      >
        <Mic className="size-4 shrink-0" aria-hidden />
        <span className="hidden md:inline">New interview</span>
        <span className="sr-only md:hidden">New interview</span>
      </NavLink>

      {GROUPS.map((g) => (
        <div key={g.name} className="space-y-1">
          <p className="hidden px-3 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/55 md:block">
            {g.name}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <li key={item.to}>
                <NavItem {...item} />
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="mt-auto space-y-0.5 border-t border-sidebar-border pt-3">
        <NavItem to="/settings" label="Settings" Icon={SettingsIcon} />
        <ServiceStatus />
      </div>
    </nav>
  );
}
