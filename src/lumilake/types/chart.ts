import { ChartType } from "chart.js";

export type ChartData = {
    labels: [],
    datasets: []
}

export type Widget = {
    id?: string;
    name: string;
    kind: ChartType;
    userId?: string;
    config?: ChartData
}

export type WidgetList = Widget[];
export type WidgetListResponse = {
    items: WidgetList
};