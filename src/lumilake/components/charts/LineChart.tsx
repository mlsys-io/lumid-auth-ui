import React from "react";
import {
    CategoryScale,
    Chart as ChartJS,
    ChartData,
    ChartOptions,
    Legend,
    LinearScale, LineElement, PointElement,
    Title,
    Tooltip
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
    Title,
    Tooltip,
    Legend,
    CategoryScale,
    LinearScale,
    LineElement,
    PointElement
);


const LineChart = ({
    data
}) => {
    const options: ChartOptions<"line"> = {
        responsive: true,
    };

    const chartData: ChartData<"line"> = {
        labels: data?.labels || [],
        datasets: data?.datasets || [],
    };

    return <Line data={chartData} options={options} />;
}

export default LineChart;