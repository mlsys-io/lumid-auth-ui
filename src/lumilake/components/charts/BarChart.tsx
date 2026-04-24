import React from "react";
import {
    BarElement,
    CategoryScale,
    Chart as ChartJS,
    ChartData,
    ChartOptions,
    Legend,
    LinearScale,
    Title,
    Tooltip
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(Title, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const BarChart = ({
  data
}) => {
    const options: ChartOptions<"bar"> = {
        responsive: true,
    };

    const chartData: ChartData<"bar"> = {
        labels: data?.labels || [],
        datasets: data?.datasets || [],
    };

    return <Bar data={chartData} options={options} />;
}

export default BarChart;