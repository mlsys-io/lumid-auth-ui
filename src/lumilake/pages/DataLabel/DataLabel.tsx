import React, { useState, useRef, useEffect } from "react";
import Icon from "../../components/ui/Icon";
import { dataLabelService } from "@/lumilake/services/dataLabelService.ts";
import { DataLabel } from "@/lumilake/types/dataLabel.ts";
import ConfirmModal from "@/lumilake/components/ui/ConfirmModal.tsx";

export const DataLabelPage: React.FC = () => {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [currentData, setCurrentData] = useState<DataLabel[]>([]);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isOpenConfirmDeleteModal, setIsOpenConfirmDeleteModal] = useState<boolean>(false);
  const [selectedDeleteDataId, setSelectedDeleteDataId] = useState<number[]>([])
  const [isBatchDelete, setIsBatchDelete] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const itemsPerPage = 10;

  // Close dropdown when clicking outside
  useEffect(() => {
    fetchDataLabel();
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [currentPage]);

  const fetchDataLabel = async () => {
    const res = await dataLabelService.getDataLabelList({
      page: currentPage,
      pageSize: itemsPerPage
    });

    setCurrentData(res.items);
    setTotalPages(res.total_page);
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set<number>(currentData.map((row) => row.id)));
    } else {
      setSelectedRows(new Set());
    }
  };

  const handleRowSelect = (rowId: number, checked: boolean) => {
    const newSelectedRows = new Set(selectedRows);
    if (checked) {
      newSelectedRows.add(rowId);
    } else {
      newSelectedRows.delete(rowId);
    }
    setSelectedRows(newSelectedRows);
  };

  const isAllSelected =
    currentData?.length > 0 &&
    currentData.every((row) => selectedRows.has(row.id));
  const isIndeterminate =
    currentData?.some((row) => selectedRows.has(row.id)) && !isAllSelected;

  const handleImport = () => {
  };

  const handleRetrieve = () => {
  };

  const handleDeleteAll = () => {

  };

  const handleRowAction = (rowId: number) => {
    setOpenDropdown(openDropdown === rowId ? null : rowId);
  };

  const openConfirmDeleteModal = (dataLabelId: number[]) => {
    if (dataLabelId && dataLabelId.length > 0) {
      setSelectedDeleteDataId(dataLabelId);
    }

    setIsOpenConfirmDeleteModal(true);
    setOpenDropdown(null)
  }

  const confirmDeleteDataLabel = async () => {
    let res;
    if (isBatchDelete) {
      res = await dataLabelService.deleteBatch(selectedDeleteDataId);
    } else {
      res = await dataLabelService.deleteOne(selectedDeleteDataId[0]);
    }

    if (res.ok) {
      await fetchDataLabel();
      cancelDeleteDataLabel();
    }
  }

  const cancelDeleteDataLabel = () => {
    handleSelectAll(false);
    setSelectedDeleteDataId([]);
    setIsOpenConfirmDeleteModal(false);
    setIsBatchDelete(false);
  }

  const getConfirmModalTitle = (): string => {
    if (isBatchDelete) {
      return `Do you want to delete ${selectedRows.size} jobs?`;
    } else {
      return `Do you want to delete this jobs?`;
    }
  }
  const renderPaginationButton = (
    page: number | string,
    isActive: boolean = false,
    isDisabled: boolean = false
  ) => (
    <button
      key={page}
      onClick={() => typeof page === "number" && setCurrentPage(page)}
      disabled={isDisabled}
      className={`
        px-3 py-2 text-sm font-medium
        ${
          isActive
            ? "bg-gray-500 text-white"
            : "bg-white text-gray-700 hover:bg-gray-50"
        }
        ${isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      {page}
    </button>
  );

  return (
    <div className="p-2 min-h-screen">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Data Label</h1>
      <div className="max-w-7xl mx-auto">

        <div className="bg-white shadow rounded-lg">
          {/* Header with actions */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing:{" "}
                <span className="font-semibold">{currentData?.length} Data</span>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={handleImport}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-0 bg-[#F9F9FB] rounded-lg hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <Icon name="upload" className="w-4 h-4 mr-2" />
                  Import
                </button>

                <button
                  onClick={handleRetrieve}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-0 bg-[#F9F9FB] rounded-lg hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <Icon name="file-download-alt" className="w-4 h-4 mr-2" />
                  Retrieve
                </button>

                <button
                  onClick={() => {
                    setIsBatchDelete(true);
                    openConfirmDeleteModal(Array.from(selectedRows))
                  }}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-0 bg-[#F9F9FB] rounded-lg hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <Icon name="trash-alt" className="w-4 h-4 mr-2" />
                  Delete All
                </button>

                <div className="relative">
                  <button className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    Filter
                    <Icon name="cheveron-down" className="w-4 h-4 ml-2" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = isIndeterminate;
                      }}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="h-4 w-4 text-blue-0 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Label
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Value
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {currentData?.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedRows.has(row.id)}
                        onChange={(e) =>
                          handleRowSelect(row.id, e.target.checked)
                        }
                        className="h-4 w-4 text-blue-0 focus:ring-blue-500 border-gray-300 rounded"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.label}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.value}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="relative" ref={openDropdown === row.id ? dropdownRef : null}>
                        <button
                          onClick={() => handleRowAction(row.id)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <span className="text-lg">⋮</span>
                        </button>
                        
                        {openDropdown === row.id && (
                          <div className="absolute right-0 mt-2 w-32 bg-white rounded-md shadow-lg border border-gray-200 z-10">
                            <div className="py-1">
                              <button
                                onClick={() => {
                                  setIsBatchDelete(false);
                                  openConfirmDeleteModal([row.id])
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-center">
              <nav className="flex items-center space-x-0">
                {/* First page */}
                {renderPaginationButton("«", false, currentPage === 1)}

                {/* Previous page */}
                {renderPaginationButton("‹", false, currentPage === 1)}

                {/* Page numbers */}
                {currentPage > 2 && renderPaginationButton(1)}
                {currentPage > 3 && (
                  <span className="px-2 text-gray-500">...</span>
                )}

                {currentPage > 1 && renderPaginationButton(currentPage - 1)}
                {renderPaginationButton(currentPage, true)}
                {currentPage < totalPages &&
                  renderPaginationButton(currentPage + 1)}

                {currentPage < totalPages - 2 && (
                  <span className="px-2 text-gray-500">...</span>
                )}
                {currentPage < totalPages - 1 &&
                  renderPaginationButton(totalPages)}

                {/* Next page */}
                {renderPaginationButton("›", false, currentPage === totalPages)}

                {/* Last page */}
                {renderPaginationButton("»", false, currentPage === totalPages)}
              </nav>
            </div>
          </div>
        </div>
      </div>
      <ConfirmModal
          isOpen={isOpenConfirmDeleteModal}
          title={getConfirmModalTitle()}
          message="This action cannot be undone."
          onConfirm={confirmDeleteDataLabel}
          onCancel={cancelDeleteDataLabel}
      />
    </div>
  );
};
