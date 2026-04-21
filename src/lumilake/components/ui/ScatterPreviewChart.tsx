import React from 'react';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  ScatterController,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, ScatterController);

const SCATTER_POINTS = [
  {x:2,y:18},{x:2.5,y:30},{x:3,y:45},{x:3.5,y:55},{x:4,y:62},{x:4,y:80},
  {x:4.5,y:70},{x:5,y:90},{x:5,y:110},{x:5.5,y:75},{x:6,y:100},{x:6,y:120},
  {x:6.5,y:135},{x:6.5,y:210},{x:7,y:145},{x:7,y:165},{x:7.5,y:125},{x:7.5,y:155},
  {x:8,y:80},{x:8,y:140},{x:8.5,y:160},{x:9,y:100},{x:9,y:115},{x:9.5,y:130},
  {x:9.5,y:150},{x:10,y:140},{x:10,y:170},{x:10.5,y:160},{x:11,y:155},{x:11,y:180},
  {x:11.5,y:175},{x:12,y:190},{x:12,y:220},{x:12.5,y:170},{x:13,y:185},{x:13,y:200},
  {x:13.5,y:165},{x:14,y:195},{x:14,y:215},{x:14.5,y:200},{x:15,y:185},{x:15,y:220},
  {x:15.5,y:210},{x:16,y:195},{x:16,y:230},{x:16.5,y:215},{x:17,y:205},{x:17,y:225},
  {x:17.5,y:200},{x:18,y:215},{x:18,y:235},{x:18.5,y:220},{x:19,y:210},{x:19,y:240},
  {x:19.5,y:225},{x:20,y:215},{x:20,y:230},
];

const TREND_LINE = Array.from({ length: 37 }, (_, i) => {
  const x = 2 + i * 0.5;
  return { x, y: Math.max(0, 12 * x - 8) };
});

const ScatterPreviewChart: React.FC = () => (
  <div>
    <h3 className="text-lg font-bold text-gray-800 mb-1">Lorem ipsum</h3>
    <p className="text-xs text-gray-500 mb-4">Lorem ipsum</p>
    <Chart
      type="scatter"
      data={{
        datasets: [
          {
            type: 'line' as const,
            label: 'Lorem',
            data: TREND_LINE,
            borderColor: '#1e3a8a',
            backgroundColor: '#1e3a8a',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            order: 1,
          },
          {
            type: 'scatter' as const,
            label: 'Lorem',
            data: SCATTER_POINTS,
            backgroundColor: '#7dd3fc',
            pointStyle: 'rect',
            pointRadius: 10,
            hoverRadius: 12,
            order: 2,
          },
        ],
      }}
      options={{
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              pointStyle: 'rect',
              color: '#374151',
              font: { size: 12 },
            },
          },
          tooltip: { mode: 'nearest' },
        },
        scales: {
          x: {
            type: 'linear',
            min: 2,
            max: 20,
            ticks: { stepSize: 2, color: '#6b7280' },
            grid: { color: '#f3f4f6' },
          },
          y: {
            min: 0,
            max: 260,
            ticks: { stepSize: 50, color: '#6b7280' },
            grid: { color: '#f3f4f6' },
          },
        },
      }}
    />
  </div>
);

export default ScatterPreviewChart;
