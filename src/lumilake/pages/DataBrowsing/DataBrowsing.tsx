import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronRight,
  RefreshCw,
  Rewind,
  Plus,
  Loader2,
  FileText,
  Folder,
  Download,
} from "lucide-react";

import { DataBrowsingService } from "@/lumilake/services/databrowsingService";
import { DBPreview, S3File } from "@/lumilake/types/dataBrowsing";

type Tab = "Databases" | "Object Storage";

export const DataBrowsing: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>("Databases");

  return (
    <div className="flex flex-col h-full w-full p-8">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-grow p-6 flex flex-col">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-3xl font-bold text-blue">Data Browsing</h2>
        </div>

        <div className="flex space-x-6 border-b border-gray-100 mb-6">
          {(["Databases", "Object Storage"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "text-blue border-b-2 border-blue-600"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-grow min-h-0">
          {activeTab === "Databases" ? <DatabaseView /> : <ObjectStorageView />}
        </div>
      </div>
    </div>
  );
};

const DatabaseView: React.FC = () => {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [preview, setPreview] = useState<DBPreview | null>(null);

  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    const loadSchemas = async () => {
      setLoadingSchemas(true);
      const data = await DataBrowsingService.getSchemas();
      setSchemas(Array.isArray(data) ? data : []);
      setLoadingSchemas(false);
    };

    loadSchemas();
  }, []);

  const loadTables = async (schema: string) => {
    if (selectedSchema === schema) {
      setSelectedSchema(null);
      setSelectedTable(null);
      setTables([]);
      setPreview(null);
      return;
    }

    setSelectedSchema(schema);
    setSelectedTable(null);
    setTables([]);
    setPreview(null);

    setLoadingTables(true);
    const data = await DataBrowsingService.getTables(schema);
    setTables(Array.isArray(data) ? data : []);
    setLoadingTables(false);
  };

  const loadPreview = async (table: string) => {
    if (!selectedSchema) return;

    setSelectedTable(table);
    setLoadingPreview(true);

    const data = await DataBrowsingService.getTablePreview(selectedSchema, table);
    setPreview(data);

    setLoadingPreview(false);
  };

  return (
    <div className="flex gap-6 h-[600px] min-w-0">
      <div className="w-64 min-w-64 flex-shrink-0 border border-gray-200 rounded-lg overflow-hidden flex flex-col bg-white">
        <div className="bg-gray-50 p-2 text-xs font-bold text-gray-500 border-b uppercase tracking-wider">
          Databases
        </div>

        <div className="p-2 space-y-1 overflow-y-auto">
          {loadingSchemas ? (
            <div className="flex justify-center p-4">
              <Loader2 className="animate-spin text-blue-500 w-5 h-5" />
            </div>
          ) : schemas.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 italic">
              No databases found
            </div>
          ) : (
            schemas.map((schema) => (
              <div key={schema} className="mb-1">
                <button
                  type="button"
                  onClick={() => loadTables(schema)}
                  className={`w-full flex items-center text-sm p-2 rounded cursor-pointer transition-colors ${
                    selectedSchema === schema
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "hover:bg-gray-50 text-gray-600"
                  }`}
                >
                  <ChevronRight
                    className={`w-4 h-4 mr-1 transition-transform ${
                      selectedSchema === schema ? "rotate-90" : ""
                    }`}
                  />
                  <span className="truncate">{schema}</span>
                </button>

                {selectedSchema === schema && (
                  <div className="mt-1 space-y-1">
                    {loadingTables ? (
                      <div className="pl-8 py-2">
                        <Loader2 className="animate-spin text-blue-500 w-4 h-4" />
                      </div>
                    ) : tables.length === 0 ? (
                      <div className="pl-8 py-2 text-xs text-gray-400 italic">
                        No tables found
                      </div>
                    ) : (
                      tables.map((table) => (
                        <button
                          type="button"
                          key={table}
                          onClick={() => loadPreview(table)}
                          className={`w-full flex justify-between items-center text-sm p-2 pl-8 rounded cursor-pointer transition-colors ${
                            selectedTable === table
                              ? "bg-blue-100 text-blue-800"
                              : "hover:bg-gray-50 text-gray-500"
                          }`}
                        >
                          <span className="truncate text-left">{table}</span>
                          <ChevronRight className="w-3 h-3 opacity-50" />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-auto border border-gray-100 rounded-lg p-4 bg-gray-50/30">
        {loadingPreview ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 italic">
            <Loader2 className="w-8 h-8 mb-2 animate-spin text-blue-400" />
            <p>Loading preview...</p>
          </div>
        ) : preview ? (
          <>
            <h3 className="text-sm font-bold text-blue-800 mb-4 flex items-center gap-2">
              <span className="bg-blue-100 px-2 py-0.5 rounded text-[10px] uppercase">
                Table
              </span>
              {preview.table}
            </h3>

            <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-gray-500">
                    {preview.columns.map((col) => (
                      <th
                        key={col.name}
                        className="px-4 py-3 font-semibold text-[11px] tracking-wider whitespace-nowrap"
                      >
                        {col.name}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100 text-gray-600">
                  {preview.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={preview.columns.length || 1}
                        className="px-4 py-6 text-center text-gray-400 italic"
                      >
                        No rows found
                      </td>
                    </tr>
                  ) : (
                    preview.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                        {preview.columns.map((col) => (
                          <td key={col.name} className="px-4 py-3 whitespace-nowrap">
                            {row[col.name] !== null && row[col.name] !== undefined
                              ? String(row[col.name])
                              : "-"}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 italic">
            <Search className="w-8 h-8 mb-2 opacity-20" />
            <p>Select a table to preview data</p>
          </div>
        )}
      </div>
    </div>
  );
};

const ObjectStorageView: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<S3File[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  
  const downloadingPath: string | null = null;

  const pathParts = useMemo(
    () => currentPath.split("/").filter(Boolean),
    [currentPath]
  );

  const loadStorage = async (path: string) => {
    setLoading(true);

    try {
      const [folderRes, fileRes] = await Promise.all([
        DataBrowsingService.getS3Folders(path),
        DataBrowsingService.getS3Files(path, 1),
      ]);

      setFolders(folderRes?.sub_folders ?? []);
      setFiles(fileRes?.files ?? []);
    } catch (error) {
      console.error("loadStorage error:", error);
      setFolders([]);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStorage(currentPath);
  }, [currentPath]);

  const goToFolder = (folder: string) => {
    setCurrentPath(folder);
  };

  const goBack = () => {
      if (!currentPath) return;
      const parts = currentPath.split("/").filter(Boolean);
      parts.pop();
      setCurrentPath(parts.length ? `${parts.join("/")}/` : "");
    };

    const refresh = () => {
      loadStorage(currentPath);
    };

  const handleDownload = (path: string) => {
    DataBrowsingService.getS3DownloadUrl(path);
    
  };

  const filteredFolders = folders.filter((folder) =>
    folder.toLowerCase().includes(search.toLowerCase())
  );

  const filteredFiles = files.filter((file) =>
    file.path.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h3 className="font-bold text-blue text-xl  ">
            {currentPath || "my-bucket"}
          </h3>
          <p className="text-xs text-gray-400">
            Path: <span className="text-blue-500 font-medium">{currentPath || "/"}</span>
          </p>

          {pathParts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mt-2 text-xs text-gray-500">
              <button
                type="button"
                onClick={() => setCurrentPath("")}
                className="hover:text-blue-600"
              >
                root
              </button>

              {pathParts.map((part, index) => {
                const partialPath = `${pathParts.slice(0, index + 1).join("/")}/`;

                return (
                  <React.Fragment key={partialPath}>
                    <span>/</span>
                    <button
                      type="button"
                      onClick={() => setCurrentPath(partialPath)}
                      className="hover:text-blue-600"
                    >
                      {part}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="relative">
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-3 pr-10 py-1.5 border border-gray-300 rounded-md text-sm"
            />
            <Search className="absolute right-3 top-2 w-4 h-4 text-gray-400" />
          </div>

          <ActionButton icon={<Plus size={14} />} label="New Path" />
          <ActionButton
            icon={<Rewind size={14} />}
            label="Rewind"
            onClick={goBack}
          />
          <ActionButton
            icon={<RefreshCw size={14} />}
            label="Refresh"
            onClick={refresh}
          />
          {/* <ActionButton
            icon={<Upload size={14} />}
            label="Upload"
            onClick={refresh}
          /> */}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-[60px_1fr_180px_120px_100px] gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <div></div>
          <div>Name</div>
          <div>Last Modified</div>
          <div>Size</div>
          <div>Action</div>
        </div>

        <div className="max-h-[500px] overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Loader2 className="w-8 h-8 mb-3 animate-spin text-blue-400" />
              <p>Loading object storage...</p>
            </div>
          ) : filteredFolders.length === 0 && filteredFiles.length === 0 ? (
            <div className="py-16 text-center text-gray-400 italic">
              No files or folders found
            </div>
          ) : (
            <>
              {filteredFolders.map((folder) => (
                <div
                  key={folder}
                  className="grid grid-cols-[60px_1fr_180px_120px_100px] gap-4 px-4 py-3 border-b border-gray-100 text-sm items-center hover:bg-blue-50/30 transition-colors"
                >
                  <div>
                    <input type="checkbox" className="rounded border-gray-300" />
                  </div>

                  <button
                    type="button"
                    onClick={() => goToFolder(folder)}
                    className="flex items-center gap-2 text-left text-gray-700 hover:text-blue-600"
                  >
                    <Folder className="w-4 h-4 text-gray-500" />
                    <span className="truncate">{getFolderName(folder)}</span>
                  </button>

                  <div className="text-gray-500">-</div>
                  <div className="text-gray-500">-</div>
                  
                </div>
              ))}

              {filteredFiles.map((file) => (
                <div
                  key={file.path}
                  className="grid grid-cols-[60px_1fr_180px_120px_100px] gap-4 px-4 py-3 border-b border-gray-100 text-sm items-center hover:bg-blue-50/30 transition-colors"
                >
                  <div>
                    <input type="checkbox" className="rounded border-gray-300" />
                  </div>

                  <div className="flex items-center gap-2 text-gray-700 min-w-0">
                    <FileText className="w-4 h-4 text-gray-500 shrink-0" />
                    <span className="truncate">{getFileName(file.path)}</span>
                  </div>

                  <div className="text-gray-500">-</div>
                  <div className="text-gray-500">{formatBytes(file.size_bytes)}</div>

                  <button
                    type="button"
                    onClick={() => handleDownload(file.path)}
                    disabled={downloadingPath === file.path}
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {downloadingPath === file.path ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {downloadingPath === file.path ? "Downloading..." : "Download"}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const ActionButton = ({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 px-3 py-1.5 border border-blue text-blue rounded text-xs font-medium hover:bg-blue hover:text-white transition-colors"
  >
    {icon} {label}
  </button>
);

const getFolderName = (path: string): string => {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = clean.split("/");
  return parts[parts.length - 1] || path;
};

const getFileName = (path: string): string => {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
};

const formatBytes = (bytes: number): string => {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};