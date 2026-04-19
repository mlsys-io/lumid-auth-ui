import React, { useEffect, useState } from 'react';
import { Icons } from '@/runmesh/components/Icons';
import { useToast } from '@/runmesh/components/Toast';
import EnterpriseTable, { TableAction, TableColumn } from '@/runmesh/components/EnterpriseTable';
import { EnterpriseModal } from '@/runmesh/components/EnterpriseTable/Modal';
import { ConfirmDialog } from '@/runmesh/components/ConfirmDialog';
import { userApi } from '@/runmesh/api';
import type { PageQuery, SysUserBo, SysUserVo } from '@/runmesh/api/user';
import { useLanguage } from '@/runmesh/i18n';

export const UserManagement: React.FC = () => {
  const { showToast, toastContainer } = useToast();
  const { t } = useLanguage();
  const [users, setUsers] = useState<SysUserVo[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pagination, setPagination] = useState<PageQuery>({
    pageNum: 1,
    pageSize: 10,
  });

  // 弹窗状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SysUserVo | null>(null);
  const [formData, setFormData] = useState<SysUserBo>({
    userName: '',
    nickName: '',
    email: '',
    phonenumber: '',
    sex: '0',
    status: '0',
    userType: 'sys_user',
    remark: '',
  });

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant?: 'default' | 'danger';
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    message: '',
    variant: 'default',
    onConfirm: () => {},
  });

  // 获取用户列表
  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params: any = {
        ...pagination,
        userName: searchQuery || undefined,
        status: statusFilter || undefined,
        userType: roleFilter || undefined,
      };

      const result = await userApi.getUserList(params);
      setUsers(result.rows || []);
      setTotal(result.total || 0);
    } catch (error: any) {
      console.error('Failed to fetch user list:', error);
      showToast({ type: 'error', message: error.message || t('adminUser.toast.fetchFailed') });
      setUsers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [pagination.pageNum, pagination.pageSize, searchQuery, roleFilter, statusFilter]);

  // 打开新增用户弹窗
  const handleAdd = () => {
    setEditingUser(null);
    setFormData({
      userName: '',
      nickName: '',
      email: '',
      phonenumber: '',
      sex: '0',
      status: '0',
      userType: 'sys_user',
      remark: '',
    });
    setIsModalOpen(true);
  };

  // 打开编辑用户弹窗
  const handleEdit = async (user: SysUserVo) => {
    try {
      const fullUser = await userApi.getUserById(user.userId);
      const userData = fullUser.user ?? (fullUser as any);
      setEditingUser(userData);
      setFormData({
        userId: userData.userId,
        userName: userData.userName,
        nickName: userData.nickName,
        email: userData.email || '',
        phonenumber: userData.phonenumber || '',
        sex: userData.sex || '0',
        status: userData.status,
        userType: userData.userType || 'sys_user',
        remark: userData.remark || '',
      });
      setIsModalOpen(true);
    } catch (error: any) {
      console.error('Failed to fetch user detail:', error);
      showToast({
        type: 'error',
        message: error.message || t('adminUser.toast.fetchDetailFailed'),
      });
    }
  };

  // 保存用户
  const handleSave = async () => {
    try {
      if (!formData.userName?.trim()) {
        showToast({ type: 'warning', message: t('adminUser.toast.usernameRequired') });
        return;
      }
      if (!formData.nickName?.trim()) {
        showToast({ type: 'warning', message: t('adminUser.toast.nicknameRequired') });
        return;
      }

      if (editingUser) {
        await userApi.updateUser(formData);
        showToast({ type: 'success', message: t('adminUser.toast.updateSuccess') });
      } else {
        if (!formData.password?.trim()) {
          showToast({ type: 'warning', message: t('adminUser.toast.passwordRequired') });
          return;
        }
        await userApi.addUser(formData);
        showToast({ type: 'success', message: t('adminUser.toast.createSuccess') });
      }

      setIsModalOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Failed to save user:', error);
      showToast({ type: 'error', message: error.message || t('adminUser.toast.saveFailed') });
    }
  };

  // 删除用户
  const handleDelete = (user: SysUserVo) => {
    setConfirmDialog({
      open: true,
      title: t('adminUser.confirm.delete.title'),
      message: user.nickName
        ? t('adminUser.confirm.delete.messageWithName', { name: user.nickName })
        : t('adminUser.confirm.delete.message'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await userApi.deleteUser([user]);
          showToast({ type: 'success', message: t('adminUser.toast.deleteSuccess') });
          fetchUsers();
        } catch (error: any) {
          console.error('Failed to delete user:', error);
          showToast({
            type: 'error',
            message: error.message || t('adminUser.toast.deleteFailed'),
          });
        } finally {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
        }
      },
    });
  };

  // 修改用户状态
  const handleToggleStatus = (userId: number, currentStatus: string, userName?: string) => {
    const newStatus = currentStatus === '0' ? '1' : '0';
    const actionText =
      newStatus === '1' ? t('adminUser.action.disable') : t('adminUser.action.enable');

    setConfirmDialog({
      open: true,
      title: t('adminUser.confirm.status.title', { action: actionText }),
      message: userName
        ? t('adminUser.confirm.status.messageWithName', { action: actionText, name: userName })
        : t('adminUser.confirm.status.message', { action: actionText }),
      variant: 'default',
      onConfirm: async () => {
        try {
          await userApi.changeUserStatus(userId, newStatus);
          showToast({
            type: 'success',
            message: t('adminUser.toast.statusSuccess', { action: actionText }),
          });
          fetchUsers();
        } catch (error: any) {
          console.error('Failed to update status:', error);
          showToast({
            type: 'error',
            message: error.message || t('adminUser.toast.statusFailed'),
          });
        } finally {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
        }
      },
    });
  };

  const getRoleLabel = (userType: string = 'sys_user') =>
    userType === 'sys_admin' ? t('adminUser.role.admin') : t('adminUser.role.user');

  const getStatusLabel = (status: string) =>
    status === '0' ? t('adminUser.status.active') : t('adminUser.status.disabled');

  const columns: TableColumn<SysUserVo>[] = [
    {
      key: 'user',
      title: t('adminUser.table.user'),
      render: (user) => (
        <div className="flex items-center">
          <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold mr-3 border border-indigo-200">
            {user.nickName?.charAt(0) || user.userName?.charAt(0) || 'U'}
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-900">{user.nickName}</div>
            <div className="text-xs text-slate-500">{user.email || user.userName}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      title: t('adminUser.table.role'),
      render: (user) => <span className="text-xs">{getRoleLabel(user.userType)}</span>,
    },
    {
      key: 'dept',
      title: t('adminUser.table.dept'),
      render: (user) => <span className="text-xs">{user.deptName || '-'}</span>,
    },
    {
      key: 'createTime',
      title: t('adminUser.table.joinDate'),
      render: (user) => (
        <span className="text-xs">
          {user.createTime ? new Date(user.createTime).toLocaleDateString('zh-CN') : '-'}
        </span>
      ),
    },
    {
      key: 'status',
      title: t('adminUser.table.status'),
      render: (user) => (
        <span
          className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${
            user.status === '0' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full mr-2.5 ${
              user.status === '0' ? 'bg-green-500' : 'bg-slate-400'
            }`}
          ></span>
          {getStatusLabel(user.status)}
        </span>
      ),
    },
  ];

  const rowActions: TableAction<SysUserVo>[] = [
    {
      key: 'edit',
      label: t('adminUser.action.edit'),
      icon: <Icons.Edit className="w-4 h-4" />,
      onClick: (record) => handleEdit(record),
      tooltip: t('adminUser.action.edit'),
      type: 'secondary',
    },
    {
      key: 'status',
      label: t('adminUser.action.toggleStatus'),
      icon: <Icons.Power className="w-4 h-4" />,
      onClick: (record) => handleToggleStatus(record.userId, record.status, record.nickName),
      tooltip: t('adminUser.action.toggleStatus'),
    },
    {
      key: 'delete',
      label: t('adminUser.action.delete'),
      icon: <Icons.Trash className="w-4 h-4" />,
      onClick: (record) => handleDelete(record),
      type: 'danger',
      tooltip: t('adminUser.action.delete'),
    },
  ];

  return (
    <>
      {toastContainer()}

      <div className="flex flex-col h-full max-h-full bg-slate-50 overflow-hidden relative">
        <div className="h-full max-h-full p-2 sm:p-4 border border-slate-200 shadow-sm overflow-hidden min-w-0 flex-1 min-h-0">
          <EnterpriseTable
            title={t('adminUser.title')}
            description={t('adminUser.subtitle')}
            columns={columns}
            data={users}
            rowKey={(user, index) => user.userId ?? `${user.userName}-${index}`}
            loading={loading}
            actions={rowActions}
            toolbarActions={[
              {
                key: 'add',
                label: t('adminUser.action.add'),
                icon: <Icons.Plus className="w-4 h-4" />,
                type: 'primary',
                onClick: handleAdd,
              },
              {
                key: 'refresh',
                label: t('adminUser.action.refresh'),
                icon: <Icons.RefreshCw className="w-4 h-4" />,
                onClick: fetchUsers,
                type: 'secondary',
              },
            ]}
            search={{
              value: searchQuery,
              onChange: (value) => {
                setSearchQuery(value);
                setPagination({ ...pagination, pageNum: 1 });
              },
              placeholder: t('adminUser.search.placeholder'),
            }}
            filters={
              <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-stretch sm:items-center w-full sm:w-auto">
                <select
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7 flex-1 sm:flex-none min-w-[120px]"
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value);
                    setPagination({ ...pagination, pageNum: 1 });
                  }}
                >
                  <option value="">{t('adminUser.filter.roleAll')}</option>
                  <option value="sys_admin">{t('adminUser.role.admin')}</option>
                  <option value="sys_user">{t('adminUser.role.user')}</option>
                </select>
                <select
                  className="px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7 flex-1 sm:flex-none min-w-[120px]"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPagination({ ...pagination, pageNum: 1 });
                  }}
                >
                  <option value="">{t('adminUser.filter.statusAll')}</option>
                  <option value="0">{t('adminUser.status.active')}</option>
                  <option value="1">{t('adminUser.status.disabled')}</option>
                </select>
              </div>
            }
            pagination={{
              pageNum: pagination.pageNum ?? 1,
              pageSize: pagination.pageSize ?? 10,
              total,
              pageSizes: [10, 20, 50, 100],
              onChange: (page) => setPagination((prev) => ({ ...prev, pageNum: page })),
              onPageSizeChange: (size) =>
                setPagination((prev) => ({ ...prev, pageNum: 1, pageSize: size })),
              compact: false,
            }}
            empty={{
              title: t('adminUser.empty.title'),
              description: t('adminUser.empty.description'),
              actionLabel: t('adminUser.action.addNow'),
              onAction: handleAdd,
              icon: <Icons.Box className="w-12 h-12 text-slate-300" />,
            }}
            height="100%"
            width="100%"
            stickyHeader={true}
          />
        </div>

        <EnterpriseModal
          open={isModalOpen}
          title={editingUser ? t('adminUser.modal.editTitle') : t('adminUser.modal.addTitle')}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleSave}
          width="60vw"
          height="auto"
          confirmText={t('adminUser.modal.save')}
        >
          <div className="px-2 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminUser.form.username')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.userName}
                  onChange={(e) => setFormData({ ...formData, userName: e.target.value })}
                  disabled={!!editingUser}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100 text-sm"
                  placeholder={t('adminUser.form.usernamePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminUser.form.nickname')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.nickName}
                  onChange={(e) => setFormData({ ...formData, nickName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  placeholder={t('adminUser.form.nicknamePlaceholder')}
                />
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('adminUser.form.password')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={formData.password || ''}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                    placeholder={t('adminUser.form.passwordPlaceholder')}
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminUser.form.email')}
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  placeholder={t('adminUser.form.emailPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminUser.form.phone')}
                </label>
                <input
                  type="tel"
                  value={formData.phonenumber}
                  onChange={(e) => setFormData({ ...formData, phonenumber: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  placeholder={t('adminUser.form.phonePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminUser.form.gender')}
                </label>
                <select
                  value={formData.sex}
                  onChange={(e) => setFormData({ ...formData, sex: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
                >
                  <option value="0">{t('adminUser.gender.male')}</option>
                  <option value="1">{t('adminUser.gender.female')}</option>
                  <option value="2">{t('adminUser.gender.unknown')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminUser.form.userType')}
                </label>
                <select
                  value={formData.userType}
                  onChange={(e) => setFormData({ ...formData, userType: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
                >
                  <option value="sys_user">{t('adminUser.role.user')}</option>
                  <option value="sys_admin">{t('adminUser.role.admin')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('adminUser.form.status')}
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-700 bg-white hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath fill=%27none%27 stroke=%27%23334155%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M2 5l6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-right-[0.5rem] bg-[length:1em_1em] pr-7"
                >
                  <option value="0">{t('adminUser.status.normal')}</option>
                  <option value="1">{t('adminUser.status.disabled')}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('adminUser.form.remark')}
              </label>
              <textarea
                value={formData.remark}
                onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                placeholder={t('adminUser.form.remarkPlaceholder')}
              />
            </div>
          </div>
        </EnterpriseModal>

        <ConfirmDialog
          isOpen={confirmDialog.open}
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
        />
      </div>
    </>
  );
};
