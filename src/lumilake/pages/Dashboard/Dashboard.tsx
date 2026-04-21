import React, { useEffect, useState } from "react";
import WidgetSelectionModal from "../../components/ui/WidgetSelectionModal";
import { useAppStore, useChartStore } from "@/lumilake/store";
import { dashboardService } from "@/lumilake/services/dashboardService.ts";
import { ChartType } from "chart.js";
import { Widget } from "@/lumilake/types/chart.ts";

const EmptyDashboard = () => {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-400 mb-2">
          No available data yet.
        </h3>
        <p className="text-gray-400 mb-4 max-w-sm">
          To start defining and deploying a job, select a workflow on the left
        </p>
        <div className="flex justify-center">
          <svg
            className="w-6 h-6 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
        </div>
      </div>
    </div>
  );
};

import BarChart from "../../components/charts/BarChart";
import LineChart from "../../components/charts/LineChart.tsx";
import AreaChart from "../../components/charts/AreaChart.tsx";
import DoughnutChart from "@/lumilake/components/charts/DoughnutChart.tsx";

const chartMap: Record<string, React.ComponentType<never>> = {
  bar: BarChart,
  line: LineChart,
  polararea: AreaChart,
  doughnut: DoughnutChart,
};

const Dashboard = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { widgets, addWidget, removeWidget, getWidgetList } = useChartStore();
  const { setLoading } = useAppStore();

  useEffect(() => {
    getWidgetList();
  }, []);

  const handleAddWidget = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const onAddWidget = async (widget: { name: string; type: ChartType }) => {
    try {
      setLoading(true);
      const newWidget: Widget = {
        kind: widget.type,
        userId: "12345",
        name: widget.name,
      };

      await dashboardService.addWidget(newWidget);
      addWidget(newWidget);
    } catch (e) {
      console.error("Error adding widget:", e);
      // Create alert toastify or notification
    } finally {
      setLoading(false);
    }
  };

  const onRemoveWidget = async (widgetType: ChartType) => {
    try {
      setLoading(true);
      const widget = widgets.find((item) => item.kind == widgetType);
      if (widget && widget.id) {
        await dashboardService.removeWidget(widget.id);
      }

      removeWidget(widgetType);
    } catch (e) {
      console.error("Error removing widget:", e);
      // Create alert toastify or notification
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 min-h-screen">
        {/* Dashboard Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold text-blue">My Dashboard</h2>
          <button
            onClick={handleAddWidget}
            className="px-4 py-2 bg-white border border-blue rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Add Widget
          </button>
        </div>

        {/* Dashboard Content */}
        {!widgets.length ? (
          <EmptyDashboard />
        ) : (
          <div className="w-full h-full">
            <div>
              {widgets.map((widget, index) => {
                const ChartComponent = chartMap[widget.kind.toLowerCase()];
                if (!ChartComponent) return null;
                return (
                  <div key={index} className="w-full h-[300px] mb-8">
                    <p className="mb-2 pl-0 font-bold">{widget.name}</p>
                    <ChartComponent
                      key={widget.id}
                      data={widget.config}
                      onRemove={() => onRemoveWidget(widget.kind)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Widget Selection Modal */}
      <WidgetSelectionModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onAddWidget={onAddWidget}
        onRemoveWidget={onRemoveWidget}
      />
    </div>
  );
};

export default Dashboard;
