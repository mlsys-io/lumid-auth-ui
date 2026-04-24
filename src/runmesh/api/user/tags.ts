import { httpUser as http } from '../../utils/axios';

/**
 * 标签相关接口
 */

export interface TagItem {
  tagId?: number;
  name?: string;
  color?: string;
  count?: number; // 使用该标签的应用数量
  createTime?: string;
  updateTime?: string;
  // 兼容工作流类型字段
  typeId?: number;
  typeCode?: string;
  typeName?: string;
  typeDesc?: string;
}

export interface PageResult<T> {
  rows: T[];
  total: number;
}

/**
 * 获取所有工作流类型（兼容旧”标签”接口）。系统标签，不可删除。
 */
export const getAllTags = () => http.get<TagItem[]>('/runmesh/workflow-types/list');

/**
 * 获取用户自定义标签 — runmesh_workflow_tag, 可删除 / 改名. Backend
 * returns a plain flat list (not PageResult), inside the standard R<T>
 * envelope that the axios interceptor already unwraps.
 */
export const getUserTagList = () => http.get<TagItem[]>('/runmesh/tags/list');

/**
 * 创建标签
 */
export const createTag = (name: string) => http.post<number>('/runmesh/tags', { name });

/**
 * 更新标签
 */
export const updateTag = (tagId: number, name: string) =>
  http.put<void>('/runmesh/tags', { tagId, name });

/**
 * 删除标签
 */
export const deleteTag = (tagId: number) => http.delete<void>(`/runmesh/tags/${tagId}`);

/**
 * 根据标签筛选工作流
 */
export const getWorkflowsByTag = (tagName: string, pageNum = 1, pageSize = 50) =>
  http.get<PageResult<any>>('/runmesh/workflows/list', {
    params: { tags: tagName, pageNum, pageSize },
  });
