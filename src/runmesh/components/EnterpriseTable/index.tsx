import React from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useLanguage } from '@/runmesh/i18n';

export interface TableColumn<T> {
  key: string;
  title: React.ReactNode;
  dataIndex?: keyof T | string;
  render?: (record: T, index: number) => React.ReactNode;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
}

export interface TableAction<T> {
  key: string;
  label: string;
  onClick: (record: T) => void;
  icon?: React.ReactNode;
  type?: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
  disabled?: boolean | ((record: T) => boolean);
  tooltip?: string | ((record: T) => string);
}

export interface ToolbarAction {
  key: string;
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  type?: 'primary' | 'secondary';
}

export interface PaginationConfig {
  pageNum: number;
  pageSize: number;
  total: number;
  pageSizes?: number[];
  onChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** 紧凑模式，分页区域整体压缩并便于小屏/高缩放显示 */
  compact?: boolean;
}

export interface EmptyState {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

export interface EnterpriseTableProps<T> {
  title?: string;
  description?: string;
  columns: TableColumn<T>[];
  data: T[];
  rowKey: (record: T, index: number) => React.Key;
  actions?: TableAction<T>[];
  toolbarActions?: ToolbarAction[];
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** 防抖/节流模式，默认防抖 */
    mode?: 'debounce' | 'throttle';
    /** 防抖延迟，默认 600ms */
    debounceDelay?: number;
    /** 节流间隔，默认 600ms */
    throttleDelay?: number;
  };
  /** 可选：在搜索区域上方插入自定义内容（slot），如统计卡片等 */
  searchExtra?: React.ReactNode;
  filters?: React.ReactNode;
  pagination?: PaginationConfig;
  loading?: boolean;
  empty?: EmptyState;
  height?: number | string;
  width?: number | string;
  stickyHeader?: boolean;
  className?: string;
  contentClassName?: string;
  headerExtra?: React.ReactNode;
  extraContent?: React.ReactNode;
  expandedRowKeys?: React.Key[];
  expandedRowRender?: (record: T, index: number) => React.ReactNode;
  rowExpandable?: (record: T) => boolean;
  /** 紧凑模式：表格宽度按列内容计算，不拉伸填满容器，避免列间大片空白 */
  compact?: boolean;
}

const actionTone: Record<NonNullable<TableAction<unknown>['type']>, string> = {
  primary: 'text-brand-600 hover:text-brand-700 hover:bg-brand-50',
  secondary: 'text-slate-600 hover:text-slate-800 hover:bg-slate-50',
  warning: 'text-amber-600 hover:text-amber-700 hover:bg-amber-50',
  danger: 'text-red-600 hover:text-red-700 hover:bg-red-50',
  ghost: 'text-slate-400 hover:text-slate-600 hover:bg-slate-50',
};

type ToolbarButtonProps = Omit<ToolbarAction, 'key'> & { actionKey: string };

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  actionKey,
  label,
  icon,
  type = 'secondary',
  onClick,
}) => (
  <button
    data-action-key={actionKey}
    onClick={onClick}
    className={`inline-flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
      type === 'primary'
        ? 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm'
        : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const TablePagination: React.FC<PaginationConfig & { compact?: boolean }> = ({
  pageNum,
  pageSize,
  total,
  pageSizes = [5, 10, 20, 50],
  onChange,
  onPageSizeChange,
  compact,
}) => {
  const { t } = useLanguage();
  const totalPages = Math.ceil(total / (pageSize || 1));
  const startItem = total === 0 ? 0 : (pageNum - 1) * pageSize + 1;
  const endItem = Math.min(pageNum * pageSize, total);

  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }

    // 总是显示第一页
    pages.push(1);

    if (pageNum <= 4) {
      // 当前页在前4页
      for (let i = 2; i <= Math.min(5, totalPages - 1); i++) {
        pages.push(i);
      }
      if (totalPages > 5) {
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    } else if (pageNum >= totalPages - 3) {
      // 当前页在后4页
      if (totalPages > 5) {
        pages.push('ellipsis');
      }
      for (let i = Math.max(2, totalPages - 4); i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // 当前页在中间
      pages.push('ellipsis');
      pages.push(pageNum - 1, pageNum, pageNum + 1);
      pages.push('ellipsis');
      pages.push(totalPages);
    }

    return pages;
  };

  return (
    <div
      className={`px-4 py-3 border-t border-slate-100 flex flex-col gap-2 md:flex-row md:items-center md:justify-between ${compact ? 'bg-white' : 'bg-slate-50'}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>{t('table.pagination.summary', { start: startItem, end: endItem, total })}</span>
        {onPageSizeChange && (
          <div className="flex flex-wrap items-center gap-2">
            <span>{t('table.pagination.perPage')}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const nextSize = Number(e.target.value);
                if (nextSize === pageSize) return;
                onPageSizeChange(nextSize);
                onChange(1);
              }}
              className="border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
        <button
          className="px-3 py-1.5 border rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          onClick={() => onChange(Math.max(pageNum - 1, 1))}
          disabled={pageNum <= 1}
          title={t('table.pagination.prev')}
        >
          <Icons.ChevronRight className="w-4 h-4 rotate-180" />
        </button>
        {getPageNumbers().map((page, index) => {
          if (page === 'ellipsis') {
            return (
              <span key={`ellipsis-${index}`} className="px-2 text-slate-400 text-xs">
                ...
              </span>
            );
          }
          return (
            <button
              key={`page-${page}`}
              className={`px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors ${
                pageNum === page
                  ? 'bg-brand-600 border-brand-600 text-white hover:bg-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 border-slate-200'
              }`}
              onClick={() => onChange(page)}
            >
              {page}
            </button>
          );
        })}
        <button
          className="px-3 py-1.5 border rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          onClick={() => onChange(Math.min(pageNum + 1, totalPages))}
          disabled={pageNum >= totalPages || totalPages === 0}
          title={t('table.pagination.next')}
        >
          <Icons.ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

function renderCell<T>(column: TableColumn<T>, record: T, index: number) {
  if (column.render) return column.render(record, index);
  if (column.dataIndex) {
    const value = (record as any)[column.dataIndex];
    return value ?? '-';
  }
  return '-';
}

export function EnterpriseTable<T extends Record<string, any>>(props: EnterpriseTableProps<T>) {
  const { t } = useLanguage();
  const {
    title,
    description,
    columns,
    data,
    rowKey,
    actions,
    toolbarActions,
    search,
    searchExtra,
    filters,
    pagination,
    loading,
    empty,
    height,
    width,
    stickyHeader = true,
    className = '',
    contentClassName = '',
    headerExtra,
    extraContent,
    expandedRowKeys,
    expandedRowRender,
    rowExpandable,
    compact = false,
  } = props;

  const containerStyle: React.CSSProperties = {
    width: width ?? '100%',
    maxWidth: '100%',
    height: height ?? '100%',
    maxHeight: height ?? '100%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const [searchInput, setSearchInput] = React.useState(search?.value ?? '');
  const debounceTimerRef = React.useRef<number | null>(null);
  const throttleTimerRef = React.useRef<number | null>(null);
  const lastThrottleCallRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (search) setSearchInput(search.value ?? '');
  }, [search?.value, search]);

  React.useEffect(
    () => () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      if (throttleTimerRef.current) window.clearTimeout(throttleTimerRef.current);
    },
    [],
  );

  const handleSearchChange = React.useCallback(
    (value: string) => {
      if (!search) return;
      const mode = search.mode ?? 'debounce';
      if (mode === 'throttle') {
        const delay = search.throttleDelay ?? 600;
        const now = Date.now();
        const remaining = delay - (now - lastThrottleCallRef.current);

        const run = () => {
          lastThrottleCallRef.current = Date.now();
          search.onChange(value);
        };

        if (remaining <= 0) {
          if (throttleTimerRef.current) {
            window.clearTimeout(throttleTimerRef.current);
            throttleTimerRef.current = null;
          }
          run();
        } else if (!throttleTimerRef.current) {
          throttleTimerRef.current = window.setTimeout(() => {
            throttleTimerRef.current = null;
            run();
          }, remaining);
        }
        return;
      }

      const delay = search.debounceDelay ?? 600;
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(() => {
        search.onChange(value);
      }, delay);
    },
    [search],
  );

  const showEmpty = !loading && data.length === 0;

  return (
    <div
      className={`flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden ${className}`}
      style={containerStyle}
    >
      {(title || toolbarActions?.length || headerExtra || description) && (
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-4 flex-shrink-0">
          <div className="min-w-0 flex-1">
            {title && (
              <h3 className="text-sm sm:text-base font-semibold text-slate-900 truncate">
                {title}
              </h3>
            )}
            {description && <p className="text-xs text-slate-500 mt-1.5">{description}</p>}
          </div>
          <div className="flex items-center space-x-3 flex-shrink-0">
            {headerExtra}
            {toolbarActions?.map((action) => {
              const { key, ...rest } = action;
              return <ToolbarButton key={key} actionKey={key} {...rest} />;
            })}
          </div>
        </div>
      )}

      {(search || filters || searchExtra) && (
        <div className="px-5 py-4 bg-slate-50/60 border-b border-slate-100 flex flex-col gap-4 flex-shrink-0">
          {searchExtra && <div className="w-full">{searchExtra}</div>}
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-4">
            {search && (
              <div className="relative w-full sm:w-64 flex-shrink-0">
                <Icons.Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSearchInput(value);
                    handleSearchChange(value);
                  }}
                  placeholder={search.placeholder ?? t('table.search.placeholder')}
                  className="pl-10 pr-3 py-2 w-full border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                />
              </div>
            )}
            {filters && <div className="flex-1 min-w-[200px]">{filters}</div>}
          </div>
        </div>
      )}

      <div
        className={`relative flex-1 min-h-0 overflow-hidden ${contentClassName}`}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {columns.length === 0 && extraContent ? (
          <div className="overflow-x-auto overflow-y-auto flex-1" style={{ minHeight: 0 }}>
            {extraContent}
          </div>
        ) : (
          <div
            className={`overflow-x-auto overflow-y-auto flex-1 ${compact ? 'w-fit max-w-full' : ''}`}
            style={{ minHeight: 0 }}
          >
            <table
              className={`divide-y divide-slate-100 ${compact ? '' : 'min-w-full'}`}
              style={{ height: 'fit-content', tableLayout: 'fixed' }}
            >
              <thead className={`bg-slate-50 ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap"
                      style={{ width: column.width, textAlign: column.align }}
                    >
                      {column.title}
                    </th>
                  ))}
                  {actions?.length ? (
                    <th
                      className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap"
                      style={compact ? { width: 120 } : undefined}
                    >
                      {t('table.header.actions')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td
                      colSpan={columns.length + (actions?.length ? 1 : 0)}
                      className="px-4 py-8 text-center"
                    >
                      <div className="flex flex-col items-center space-y-3 text-slate-500">
                        <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-brand-600" />
                        <span className="text-xs">{t('table.loading')}</span>
                      </div>
                    </td>
                  </tr>
                ) : showEmpty ? (
                  <tr>
                    <td
                      colSpan={columns.length + (actions?.length ? 1 : 0)}
                      className="px-4 py-8 text-center"
                    >
                      <div className="flex flex-col items-center justify-center space-y-3 text-slate-500">
                        {empty?.icon ?? <Icons.Box className="w-10 h-10 text-slate-300" />}
                        <div>
                          <p className="text-xs font-medium text-slate-600">
                            {empty?.title ?? t('table.empty.title')}
                          </p>
                          <p className="text-xs text-slate-400 mt-1.5">
                            {empty?.description ?? t('table.empty.description')}
                          </p>
                        </div>
                        {empty?.actionLabel && empty?.onAction && (
                          <button
                            onClick={empty.onAction}
                            className="inline-flex items-center px-3 py-2 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-700"
                          >
                            {empty.actionLabel}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  data.map((record, index) => {
                    const rowKeyValue = rowKey(record, index);
                    const isExpanded = expandedRowKeys?.includes(rowKeyValue) ?? false;
                    const canExpand = rowExpandable ? rowExpandable(record) : true;
                    return (
                      <React.Fragment key={rowKeyValue}>
                        <tr className="hover:bg-slate-50 transition-colors">
                          {columns.map((column) => (
                            <td
                              key={column.key}
                              className="px-4 py-3 text-xs text-slate-700"
                              style={{ textAlign: column.align }}
                            >
                              {renderCell(column, record, index)}
                            </td>
                          ))}
                          {actions?.length ? (
                            <td className="px-4 py-3 text-right text-xs font-medium whitespace-nowrap">
                              <div className="flex justify-end space-x-2">
                                {actions.map((action) => {
                                  const disabled =
                                    typeof action.disabled === 'function'
                                      ? action.disabled(record)
                                      : action.disabled;
                                  const tooltip =
                                    typeof action.tooltip === 'function'
                                      ? action.tooltip(record)
                                      : (action.tooltip ?? action.label);
                                  return (
                                    <button
                                      key={action.key}
                                      onClick={() => {
                                        if (disabled) return;
                                        action.onClick(record);
                                      }}
                                      title={tooltip}
                                      disabled={disabled}
                                      className={`p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs ${actionTone[action.type ?? 'ghost']}`}
                                    >
                                      {action.icon ?? action.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                        {expandedRowRender && isExpanded && canExpand && (
                          <tr className="bg-slate-50/40">
                            <td
                              colSpan={columns.length + (actions?.length ? 1 : 0)}
                              className="px-4 py-4"
                            >
                              {expandedRowRender(record, index)}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination && (
        <div className="flex-shrink-0">
          <TablePagination
            pageNum={pagination.pageNum}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onChange={pagination.onChange}
            onPageSizeChange={pagination.onPageSizeChange}
            pageSizes={pagination.pageSizes}
            compact={pagination.compact}
          />
        </div>
      )}
      {columns.length > 0 && extraContent && (
        <div className="flex-shrink-0 border-t border-slate-200">{extraContent}</div>
      )}
    </div>
  );
}

export default EnterpriseTable;
