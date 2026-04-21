import { create } from 'zustand';
import { ChartData, ChartType, ChartTypeRegistry } from "chart.js";
import { Widget } from "@/lumilake/types/chart.ts";
import { dashboardService } from "@/lumilake/services/dashboardService.ts";
interface ChartState {
    chartType: ChartTypeRegistry,
    chartData: ChartData;
    setChartType: (type: ChartTypeRegistry) => void;
    setChartData: (data: ChartData) => void;
    widgets: Widget[];
    addWidget: (widget: Widget) => void;
    removeWidget: (widgetId: string) => void;
}

export const useChartStore = create<ChartState>((set, get) => ({
    chartType: 'bar',
    chartData: {
        labels: [],
        datasets: []
    },
    widgets: [],
    setChartType: (type) => set({ chartType: type }),
    setChartData: (data) => set({ chartData: data }),
    addWidget: async (widget: Widget) => {
        set((state) => ({
            widgets: [...state.widgets, widget],
        }));

        const { getWidgetList } = get();
        await getWidgetList();
    },
    removeWidget: async (widgetType: ChartType) => {
        set(state => ({
            widgets: state.widgets.filter(widget => widget.type !== widgetType),
        }));

        const { getWidgetList } = get();
        await getWidgetList();
    },
    getWidgetList: async () => {
        const widgets = await dashboardService.getWidgetList()
        set({ widgets });
    }
}));