import React, { useState } from "react";
import { Search } from "lucide-react";
import { ChartType } from "chart.js";

import Modal from "./Modal";
import Icon, {IconName} from "./Icon";
import CardTemplate from "./CardTemplate";

// Import the chart template images
import barChartTemplate from "../../assets/images/bar-chart-template.png";
import lineChartTemplate from "../../assets/images/line-chart-template.png";
import mixedChartTemplate from "../../assets/images/mixed-chart-template.png";
import { useChartStore } from "@/lumilake/store";

interface WidgetTemplate {
    id: string;
    name: string;
    category: string;
    description: string;
    image: string;
    type: ChartType;
}

interface WidgetSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddWidget: (widget: WidgetTemplate) => void;
    onRemoveWidget: (widgetType: ChartType) => void;
}

const WidgetSelectionModal: React.FC<WidgetSelectionModalProps> = ({
   isOpen,
   onClose,
   onAddWidget,
   onRemoveWidget,
}) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const {widgets} = useChartStore()

    const categories: { id: string; name: string; icon: IconName }[] = [
        {id: "finance", name: "Finance", icon: "dollar-alt"},
        {id: "science", name: "Science", icon: "flask"},
    ];

    const widgetTemplates: WidgetTemplate[] = [
        {
            id: "bar-chart",
            name: "Bar Chart",
            category: "finance",
            description: "Description of widget goes here",
            image: barChartTemplate as string,
            type: 'bar',
        },
        {
            id: "line-chart",
            name: "Line Chart",
            category: "finance",
            description: "Description of widget goes here",
            image: lineChartTemplate as string,
            type: 'line',
        },
        {
            id: "doughnut-chart",
            name: "Doughnut Chart",
            category: "finance",
            description: "Description of widget goes here",
            image: mixedChartTemplate as string,
            type: 'doughnut',
        },
        {
            id: "area-chart",
            name: "Area Chart",
            category: "finance",
            description: "Description of widget goes here",
            image: barChartTemplate as string,
            type: 'polarArea',
        }
    ];

    const filteredWidgets = widgetTemplates.filter((widget) => {
        const matchesSearch = widget.name
            .toLowerCase()
            .includes(searchTerm.toLowerCase());
        const matchesCategory =
            !selectedCategory || widget.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const handleSelectWidget = (widget: WidgetTemplate) => {
        onAddWidget(widget);
    };

    const handleRemoveWidget = (widget: WidgetTemplate) => {
        onRemoveWidget(widget.type);
    };

    const isWidgetSelected = (type: ChartType) => {
        return widgets.some((widget) => widget.kind === type);
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Widget Library">
            <div className="h-full flex flex-col">
                {/* Search */}
                <div className="relative mb-4">
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <Search className="h-5 w-5 text-gray-400"/>
                    </div>
                    <input
                        type="text"
                        placeholder="Search"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="block w-full pr-10 pl-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                {/* Main Content Container */}
                <div className="flex gap-6 flex-1 min-h-0">
                    {/* Left Sidebar - Categories */}
                    <div className="w-64 bg-gray-50 rounded-lg p-4 flex-shrink-0">
                        <div>
                            <h4 className="text-sm font-medium text-gray-900 mb-3">
                                CHOOSE A FIELD
                            </h4>
                            <div className="space-y-2">
                                {categories.map((category) => (
                                    <button
                                        key={category.id}
                                        onClick={() =>
                                            setSelectedCategory(
                                                selectedCategory === category.id ? "" : category.id
                                            )
                                        }
                                        className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                                            selectedCategory === category.id
                                                ? "bg-blue-100 text-blue-700"
                                                : "text-gray-700 hover:bg-gray-100"
                                        }`}
                                    >
                                        <Icon name={category.icon} className="w-4 h-4 mr-3"/>
                                        {category.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="h-full overflow-y-auto">
                            <div className="grid grid-cols-3 gap-4 p-2 justify-items-center">
                                {filteredWidgets.map((widget) => (
                                    <CardTemplate
                                        key={widget.id}
                                        title={widget.name}
                                        image={widget.image}
                                        description={widget.description}
                                        buttonText={isWidgetSelected(widget.type) ? "Remove from DashBoard" : "Add to Dashboard"}
                                        onButtonClick={() => {
                                            if (isWidgetSelected(widget.type)) {
                                                handleRemoveWidget(widget);
                                            } else {
                                                handleSelectWidget(widget);
                                            }
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default WidgetSelectionModal;
