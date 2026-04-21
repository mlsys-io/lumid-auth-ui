import React from "react";
interface TableProps {
    header: string[],
    data: (string | number)[][]
}

const Table: React.FC<TableProps> = ({
    header,
    data,
}) => {
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-300 rounded-lg shadow-md">
                <thead className="bg-gray-100">
                <tr>
                    {
                        header.map((col, index) => (
                            <th key={index} className="px-4 py-2 text-center text-sm font-semibold text-gray-700 border-b">
                                {col}
                            </th>
                        ))
                    }
                </tr>
                </thead>
                <tbody>
                {
                    data.map((row,index) => (
                        <tr key={index} className="hover:bg-gray-50">
                            {
                                row.map((cell, cellIndex) => (
                                    <td key={cellIndex} className="px-4 py-2 border-b text-sm text-gray-700">
                                        {cell}
                                    </td>
                                ))
                            }
                        </tr>
                    ))
                }
                </tbody>
            </table>
        </div>
    );
}

export default Table;