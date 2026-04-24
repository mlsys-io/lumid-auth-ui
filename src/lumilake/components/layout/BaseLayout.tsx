import React from 'react';
import { Outlet, useLocation } from 'react-router';
import Sidebar from './Sidebar';

const pageNames: Record<string, string> = {
  '/': 'Running Jobs',
  '/running-jobs': 'Running Jobs',
  '/dashboard': 'Dashboard',
  '/low-code': 'Low Code Editor',
  '/sql': 'SQL Query',
  '/python': 'Python',
  '/modelling': 'Modelling',
  '/data-label': 'Data Label',
  '/models': 'Models',
  '/resource': 'Resources',
  '/workflow': 'Workflow',
  '/worker-management': 'Worker Management',
  '/data-browsing': 'Data Browsing',
  '/admin': 'Admin Dashboard',
  '/admin/users': 'User Management',
  '/User-Profile': 'Profile',
  '/Settings': 'Settings',
  '/Change-Password': 'Change Password',
  '/Help': 'Help',
};

const BaseLayout: React.FC = () => {
  const location = useLocation();
  const pageTitle = pageNames[location.pathname] || 'Lumilake';

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 ml-64 overflow-auto">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/80 backdrop-blur-sm border-b border-border px-6 py-3">
          <h1 className="text-lg font-semibold text-foreground">{pageTitle}</h1>
        </div>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default BaseLayout;
