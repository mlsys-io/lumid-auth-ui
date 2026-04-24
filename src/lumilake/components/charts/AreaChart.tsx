import React from "react";
import {
    Chart as ChartJS,
    ChartData,
    ChartOptions,
    Title,
    Tooltip,
    Legend,
    RadialLinearScale,
    ArcElement,
} from "chart.js";
import { PolarArea } from "react-chartjs-2";

// Register required components for PolarArea
ChartJS.register(RadialLinearScale, ArcElement, Title, Tooltip, Legend);

const PolarAreaChart = ({ data }) => {
    const options: ChartOptions<"polarArea"> = {
        responsive: true,
    };

    const chartData: ChartData<"polarArea"> = {
        labels: data?.labels || [],
        datasets: data?.datasets || [],
    };

    return <PolarArea data={chartData} options={options} />;
};

export default PolarAreaChart;
