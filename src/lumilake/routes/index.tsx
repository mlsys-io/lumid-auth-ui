import { createBrowserRouter } from "react-router";
import { BaseLayout } from "../components/layout";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { Dashboard } from "../pages/Dashboard";
import { Login } from "../pages/Login";
import LumidSSO from "../pages/Login/LumidSSO";
import { LowCode } from "../pages/LowCode";
import { SQL } from "../pages/SQL";
import { Python } from "../pages/Python";
import { Modelling } from "../pages/Modelling";
import { DataLabelPage } from "../pages/DataLabel";
import { Models } from "../pages/Models";
import { Resource } from "../pages/Resource";
import { Workflow } from "../pages/Workflow";
import { RunningJobs } from "../pages/RunningJobs";
import { AdminDashboard } from "../pages/Admin/AdminDashboard";
import { DataBrowsing } from "../pages/DataBrowsing";
import { UserManagement } from "../pages/UserManagement";
import { AdminRoute } from "../components/AdminRoute";
import { WorkerManagement } from "../pages/WorkerManagement";
import { ChangePassword, UserProfile, Settings, Help } from "@/lumilake/pages/UserProfile";


export const router = createBrowserRouter([
  {
    path: "/login",
    element: <Login />,
  },
  {
    // Bridge from https://lum.id/auth/account — see pages/Login/LumidSSO.tsx.
    path: "/sso/lumid",
    element: <LumidSSO />,
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <BaseLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <RunningJobs />,
      },
      {
        path: "dashboard",
        element: <Dashboard />,
      },
      {
        path: "low-code",
        element: <LowCode />,
      },
      {
        path: "sql",
        element: <SQL />,
      },
      {
        path: "python",
        element: <Python />,
      },
      {
        path: "modelling",
        element: <Modelling />,
      },
      {
        path: "data-label",
        element: <DataLabelPage />,
      },
      {
        path: "models",
        element: <Models />,
      },
      {
        path: "resource",
        element: <Resource />,
      },
      {
        path: "workflow",
        element: <Workflow />,
      },
      {
        path: "running-jobs",
        element: <RunningJobs />,
      },
      {
        path: "worker-management",
        element: <WorkerManagement />,
      },

      {
        path: "data-browsing",
        element: <DataBrowsing />,
      },

      {
        path: "User-Profile",
        element: <UserProfile />,
      },

      {
        path: "Settings",
        element: <Settings />,
      },

      {
        path: "Change-Password",
        element: <ChangePassword />,
      },
      {
        path: "Help",
        element: <Help />,
      },
      // ACCESSIBLE BY BOTH USER & ADMIN
      {
        path: "admin",
        element: (
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        ),
      },
      {
        path: "admin/users",
        element: (
          <AdminRoute>
            <UserManagement />
          </AdminRoute>
        ),
      },
    ],
  },
]);