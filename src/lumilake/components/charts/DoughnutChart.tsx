import React from "react";
import {
    Chart as ChartJS,
    ChartData,
    ChartOptions,
    Title,
    Tooltip,
    Legend,
    ArcElement,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Title, Tooltip, Legend);

const DoughnutChart = ({ data }) => {
    const options: ChartOptions<"doughnut"> = {
        responsive: true,
    };

    const chartData: ChartData<"doughnut"> = {
        labels: data?.labels || [],
        datasets: data?.datasets || [],
    };

    return <Doughnut data={chartData} options={options} />;
};

export default DoughnutChart;
