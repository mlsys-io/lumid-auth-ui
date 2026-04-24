import {Widget, WidgetList, WidgetListResponse} from "@/lumilake/types/chart.ts";
import { apiService } from "@/lumilake/services/api.ts";

export const dashboardService = {
    searchData: async (searchTerm: string): Promise<[]> => {
        const data = await apiService.get(`/search?q=${searchTerm}`)

        return data.items;
    },
    addWidget: async (widget: Widget): Promise<string> => {
        return await apiService.post<string>(`/widgets`, widget);
    },
    removeWidget: async (widgetId: string) => {
        return await apiService.delete<WidgetList>(`/widgets/${widgetId}`);
    },
    getWidgetList: async (): Promise<WidgetList> => {
        const data = await apiService.get<WidgetListResponse>('/widgets');

        return data.items;
    }
}