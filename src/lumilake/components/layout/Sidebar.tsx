import { Link, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard,
  Play,
  Workflow,
  Database,
  Server,
  Users,
  Settings,
  LogOut,
  ChevronDown,
  BrainCircuit,
  Code2,
  FileCode2,
  FlaskConical,
  FolderOpen,
  Tag,
} from "lucide-react";
import { useAuthStore } from "../../store/useAuthStore";
import { useEndpointStore } from "../../store/useEndpointStore";
import { cn } from "../../lib/utils";
import { useState, useRef, useEffect } from "react";

const navGroups = [
  {
    label: "Workflow",
    items: [
      { id: "running-jobs", label: "Running Jobs", icon: Play, path: "/running-jobs" },
      { id: "low-code", label: "Low Code Editor", icon: Workflow, path: "/low-code" },
    ],
  },
  {
    label: "Resources",
    items: [
      { id: "data-browsing", label: "Data Browsing", icon: Database, path: "/data-browsing" },
      { id: "worker-management", label: "Workers", icon: Server, path: "/worker-management" },
      { id: "models", label: "Models", icon: FlaskConical, path: "/models" },
      { id: "resource", label: "Resources", icon: FolderOpen, path: "/resource" },
    ],
  },
  {
    label: "Tools",
    items: [
      { id: "sql", label: "SQL Query", icon: Code2, path: "/sql" },
      { id: "python", label: "Python", icon: FileCode2, path: "/python" },
      { id: "modelling", label: "Modelling", icon: FlaskConical, path: "/modelling" },
      { id: "data-label", label: "Data Label", icon: Tag, path: "/data-label" },
    ],
  },
];

const adminItems = [
  { id: "admin-dashboard", label: "Admin Dashboard", icon: LayoutDashboard, path: "/admin" },
  { id: "admin-users", label: "User Management", icon: Users, path: "/admin/users" },
];

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { endpoints, activeUrl, setActiveUrl } = useEndpointStore();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isActive = (path: string) =>
    location.pathname === path || (path === "/running-jobs" && location.pathname === "/");

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node))
        setShowUserMenu(false);
    };
    if (showUserMenu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showUserMenu]);

  const handleLogout = () => {
    setShowUserMenu(false);
    logout();
  };

  return (
    <div className="fixed left-0 top-0 w-64 h-screen flex flex-col bg-white border-r border-border z-40">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <Link to="/" className="flex items-center gap-2">
          <div className="p-2 bg-gradient-to-br from-primary to-indigo-700 rounded-lg">
            <BrainCircuit className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Lumilake</h2>
            <p className="text-xs text-muted-foreground">Analytics Engine</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-6">
            <p className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.id}
                  to={item.path}
                  className={cn(
                    "relative flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive(item.path)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {isActive(item.path) && (
                    <span className="absolute left-0 top-0 h-full w-[2px] bg-primary rounded-r" />
                  )}
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}

        {isAdmin && (
          <div className="mb-6">
            <p className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Admin
            </p>
            <div className="space-y-0.5">
              {adminItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.path}
                  className={cn(
                    "relative flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive(item.path)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {isActive(item.path) && (
                    <span className="absolute left-0 top-0 h-full w-[2px] bg-primary rounded-r" />
                  )}
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Endpoint Switcher */}
      <div className="border-t border-border px-3 py-3">
        <p className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Backend
        </p>
        <div className="flex gap-1 px-1">
          {endpoints.map((ep) => (
            <button
              key={ep.url}
              onClick={() => setActiveUrl(ep.url)}
              className={cn(
                "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                activeUrl === ep.url
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {ep.label}
            </button>
          ))}
        </div>
      </div>

      {/* User Profile */}
      <div className="border-t border-border p-3" ref={userMenuRef}>
        <button
          onClick={() => setShowUserMenu((v) => !v)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-sm font-semibold text-primary">
              {user?.name?.charAt(0).toUpperCase() || "U"}
            </span>
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{user?.name || "User"}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>

        {showUserMenu && (
          <div className="absolute bottom-16 left-3 right-3 bg-white border border-border rounded-lg shadow-lg p-2 z-50">
            <button
              onClick={() => { navigate("/User-Profile"); setShowUserMenu(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent rounded-md"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            <div className="border-t border-border my-1" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/5 rounded-md"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
