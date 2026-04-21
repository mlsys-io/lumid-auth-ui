import { httpUser as http } from '../../utils/axios';

// 用户数据接口定义
export interface SysUserVo {
  userId: number;
  tenantId?: string;
  deptId?: number;
  userName: string;
  nickName: string;
  userType?: string;
  email?: string;
  phonenumber?: string;
  sex?: string;
  avatar?: string;
  password?: string;
  status: string;
  loginIp?: string;
  loginDate?: string;
  remark?: string;
  createTime?: string;
  deptName?: string;
  roles?: any[];
  roleIds?: number[];
  postIds?: number[];
  roleId?: number;
  nid?: string;
  keyId?: string;
  tokenKey?: string;
}

export interface SysUserBo {
  userId?: number;
  deptId?: number;
  userName?: string;
  nickName?: string;
  userType?: string;
  email?: string;
  phonenumber?: string;
  sex?: string;
  password?: string;
  status?: string;
  remark?: string;
  roleIds?: number[];
  postIds?: number[];
  roleId?: number;
  tokenKey?: string;
  userIds?: string;
  excludeUserIds?: string;
  params?: {
    beginTime?: string;
    endTime?: string;
  };
}

export interface SysUserPasswordBo {
  oldPassword?: string;
  newPassword?: string;
}

export interface PageQuery {
  pageNum?: number;
  pageSize?: number;
  orderByColumn?: string;
  isAsc?: string;
}

export interface TableDataInfo<T> {
  total: number;
  rows: T[];
  code: number;
  msg: string;
}

// 用户信息详情（包含角色、岗位等信息）
export interface SysUserInfoVo {
  user?: SysUserVo;
  roles?: any[];
  roleIds?: number[];
  posts?: any[];
  postIds?: number[];
}

// 分页查询用户列表
export const getUserList = (query: SysUserBo & PageQuery) =>
  http.get<TableDataInfo<SysUserVo>>('/runmesh/system/user/list', {
    params: query,
  });

// 获取用户详情（包含角色、岗位等信息）
export const getUserById = (userId: number) =>
  http.get<SysUserInfoVo>(`/runmesh/system/user/${userId}`);

// 新增用户
export const addUser = (data: SysUserBo) => http.post<number>('/runmesh/system/user', data);

// 修改用户
export const updateUser = (data: SysUserBo) => http.put<void>('/runmesh/system/user', data);

// 修改个人信息
export const updateUserProfile = (data: SysUserBo) =>
  http.put<void>('/runmesh/system/user/profile', data);

// 修改密码
export const updatePassword = (data: SysUserPasswordBo) =>
  http.put<void>('/runmesh/system/user/updatePwd', data);

// 上传用户头像
export const uploadAvatar = (file: File) => {
  const formData = new FormData();
  formData.append('avatarfile', file);
  return http.post<{ imgUrl: string }>('/runmesh/system/user/avatar', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

// 删除用户（接受用户对象列表，使用 POST 请求避免 DELETE body 兼容性问题）
export const deleteUser = (users: SysUserVo[]) =>
  http.post<void>('/runmesh/system/user/delete', users);

// 修改用户状态
export const changeUserStatus = (userId: number, status: string) =>
  http.put<void>('/runmesh/system/user/changeStatus', null, {
    params: { userId, status },
  });

// 根据用户名查询用户
export const getUserByName = (userName: string) =>
  http.get<SysUserVo>(`/runmesh/system/user/getUserByName/${userName}`);

// 获取所有用户（不分页）
export const getAllUsers = (query?: SysUserBo) =>
  http.get<SysUserVo[]>('/runmesh/system/user/all', {
    params: query,
  });
