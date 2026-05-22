// New user-facing shell — consumer UX for the web-first revamp.
//
// Mounted at xp.io/go/* during P0-P3 (set VITE_ROUTER_BASE_PATH=/go at
// build time + serve from a separate container). Eventually graduates
// to xp.io/* or replaces lum.id/dashboard/* outright.
//
// Visual language vs admin-layout.tsx:
//   - Top tab-bar nav, NOT a left sidebar
//   - Indigo accent, light card-shaped surfaces
//   - Mobile-first: tabs collapse to a hamburger ≤640px
//   - Floating chat-widget slot reserved for P4 (bottom-right)
//
// Routes mounted inside the <Outlet>: Home / Marketplace / My Loops /
// My Results / My Knowledge (+ Onboarding lives outside this shell).

import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Home as HomeIcon,
  ShoppingBag,
  RefreshCw,
  BarChart3,
  Brain,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Shield,
  GraduationCap,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import ChatWidget from "./chat-widget";

interface TabItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const USER_TABS: TabItem[] = [
  { to: "/app",             label: "Home",         icon: HomeIcon, end: true },
  { to: "/app/marketplace", label: "Marketplace",  icon: ShoppingBag },
  { to: "/app/loops",       label: "My Loops",     icon: RefreshCw },
  { to: "/app/results",     label: "My Results",   icon: BarChart3 },
  { to: "/app/knowledge",   label: "My Knowledge", icon: Brain },
];

function Tab({ to, label, icon: Icon, end, onClick }: TabItem & { onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
          isActive
            ? "bg-indigo-100 text-indigo-700 font-medium"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        )
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function UserLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const close = () => setMenuOpen(false);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top tab bar */}
      <header className="bg-white border-b border-slate-200/60 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center gap-3 h-14">
          {/* Brand */}
          <NavLink to="/app" className="flex items-center gap-2 shrink-0">
            <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-md shadow-sm">
              <HomeIcon className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-sm hidden sm:inline">Lumid</span>
          </NavLink>

          {/* Desktop tabs */}
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {USER_TABS.map((t) => (
              <Tab key={t.to} {...t} />
            ))}
          </nav>

          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden ml-auto"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </Button>

          {/* Profile dropdown */}
          <div className="ml-auto hidden md:flex relative">
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-slate-100 text-sm"
            >
              <span className="text-slate-700">{user?.username || user?.email?.split("@")[0] || "you"}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {profileOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-md shadow-lg py-1 text-sm z-40"
                onMouseLeave={() => setProfileOpen(false)}
              >
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="font-medium truncate">{user?.username || user?.email?.split("@")[0]}</p>
                  <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                </div>
                <NavLink to="/account/profile" className="block px-3 py-1.5 hover:bg-slate-50">Profile</NavLink>
                <NavLink to="/account/tokens"  className="block px-3 py-1.5 hover:bg-slate-50">Tokens</NavLink>
                <NavLink to="/onboarding/welcome" className="px-3 py-1.5 hover:bg-indigo-50 text-indigo-700 flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5" />
                  Welcome tour
                </NavLink>
                {isAdmin && (
                  <NavLink to="/admin" className="px-3 py-1.5 hover:bg-indigo-50 text-indigo-700 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" />
                    Switch to admin view
                  </NavLink>
                )}
                <button
                  onClick={async () => {
                    await logout();
                    navigate("/auth/login");
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-rose-700 flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <nav className="md:hidden border-t border-slate-200/60 bg-white px-4 py-2 flex flex-col gap-1">
            {USER_TABS.map((t) => (
              <Tab key={t.to} {...t} onClick={close} />
            ))}
            <div className="border-t border-slate-100 pt-2 mt-1">
              <NavLink to="/account/profile" onClick={close} className="block px-3 py-2 text-sm hover:bg-slate-100 rounded">
                Profile
              </NavLink>
              <NavLink to="/onboarding/welcome" onClick={close} className="px-3 py-2 text-sm hover:bg-indigo-50 text-indigo-700 rounded flex items-center gap-1.5">
                <GraduationCap className="w-3.5 h-3.5" />
                Welcome tour
              </NavLink>
              {isAdmin && (
                <NavLink to="/admin" onClick={close} className="block px-3 py-2 text-sm hover:bg-indigo-50 text-indigo-700 rounded">
                  Switch to admin view
                </NavLink>
              )}
              <button
                onClick={async () => {
                  await logout();
                  navigate("/auth/login");
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-rose-50 text-rose-700 rounded"
              >
                Sign out
              </button>
            </div>
          </nav>
        )}
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-6">
        <Outlet />
      </main>

      {/* Conversational shell — natural-interaction layer (P4). */}
      <ChatWidget />
    </div>
  );
}
