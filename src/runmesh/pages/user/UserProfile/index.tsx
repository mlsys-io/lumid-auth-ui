import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons } from '@/runmesh/components/Icons';
import { useAuthStore } from '@/runmesh/stores/useAuthStore';
import { fetchCurrentUser } from '@/runmesh/api/user/auth';
import { updateUserProfile, updatePassword, uploadAvatar, SysUserBo } from '@/runmesh/api/user/user';
import {
  listApiTokens,
  generateApiToken,
  revokeApiToken,
  regenerateApiToken,
  ApiTokenVo,
} from '@/runmesh/api/user/apiToken';
import { useToast } from '@/runmesh/components/Toast';
import { useLanguage } from '@/runmesh/i18n';

// 编辑资料弹窗
const ProfileEditModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  initialData: SysUserBo;
  onSuccess: () => void;
}> = ({ isOpen, onClose, initialData, onSuccess }) => {
  const { t } = useLanguage();
  const [formData, setFormData] = useState<SysUserBo>(initialData);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setFormData(initialData);
    }
  }, [isOpen, initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      await updateUserProfile(formData);
      showToast({ type: 'success', message: t('userProfile.toast.profileUpdated') });
      onSuccess();
      onClose();
    } catch (error: any) {
      showToast({ type: 'error', message: error.msg || t('userProfile.toast.updateFailed') });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">{t('userProfile.editProfile.title')}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">
                {t('userProfile.editProfile.nickname')}
              </label>
              <input
                type="text"
                value={formData.nickName}
                onChange={(e) => setFormData({ ...formData, nickName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">
                {t('userProfile.editProfile.gender')}
              </label>
              <select
                value={formData.sex}
                onChange={(e) => setFormData({ ...formData, sex: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white"
              >
                <option value="0">{t('userProfile.gender.male')}</option>
                <option value="1">{t('userProfile.gender.female')}</option>
                <option value="2">{t('userProfile.gender.unknown')}</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">
                {t('userProfile.editProfile.phone')}
              </label>
              <input
                type="text"
                value={formData.phonenumber}
                onChange={(e) => setFormData({ ...formData, phonenumber: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">
                {t('userProfile.editProfile.email')}
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              {t('dialog.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? t('userProfile.editProfile.saving') : t('userProfile.editProfile.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// 修改密码弹窗
const PasswordEditModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.newPassword !== formData.confirmPassword) {
      showToast({ type: 'error', message: t('userProfile.password.mismatch') });
      return;
    }
    try {
      setLoading(true);
      await updatePassword({
        oldPassword: formData.oldPassword,
        newPassword: formData.newPassword,
      });
      showToast({ type: 'success', message: t('userProfile.password.updated') });
      onClose();
      setFormData({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      showToast({ type: 'error', message: error.msg || t('userProfile.password.verifyFailed') });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">{t('userProfile.password.title')}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">
              {t('userProfile.password.old')}
            </label>
            <input
              type="password"
              value={formData.oldPassword}
              onChange={(e) => setFormData({ ...formData, oldPassword: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder={t('userProfile.password.oldPlaceholder')}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">
              {t('userProfile.password.new')}
            </label>
            <input
              type="password"
              value={formData.newPassword}
              onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder={t('userProfile.password.newPlaceholder')}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">
              {t('userProfile.password.confirm')}
            </label>
            <input
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder={t('userProfile.password.confirmPlaceholder')}
              required
            />
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              {t('dialog.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {loading
                ? t('userProfile.password.updating')
                : t('userProfile.password.confirmAction')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const UserProfile: React.FC = () => {
  const { user: authUser, setUser } = useAuthStore();
  const { showToast, toastContainer } = useToast();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [fetching, setFetching] = useState(true);
  const [userData, setUserData] = useState<any>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [flowmeshKey, setFlowmeshKey] = useState('');
  const [flowmeshKeyVisible, setFlowmeshKeyVisible] = useState(false);
  const [flowmeshSaving, setFlowmeshSaving] = useState(false);

  // API Token state
  const [apiTokens, setApiTokens] = useState<ApiTokenVo[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [showNewTokenModal, setShowNewTokenModal] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [generatingToken, setGeneratingToken] = useState(false);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const loadApiTokens = useCallback(async () => {
    try {
      setTokensLoading(true);
      const tokens = await listApiTokens();
      setApiTokens(Array.isArray(tokens) ? tokens : []);
    } catch {
      // Silently fail — tokens list is not critical
    } finally {
      setTokensLoading(false);
    }
  }, []);

  const handleGenerateToken = async () => {
    if (!newTokenName.trim()) return;
    try {
      setGeneratingToken(true);
      const result = await generateApiToken({ tokenName: newTokenName.trim() });
      setNewlyCreatedToken(result.tokenValue);
      setNewTokenName('');
      await loadApiTokens();
    } catch (error: any) {
      showToast({ type: 'error', message: error.msg || t('userProfile.apiTokens.generateFailed') });
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleRevokeToken = async (tokenId: number) => {
    try {
      await revokeApiToken(tokenId);
      showToast({ type: 'success', message: t('userProfile.apiTokens.revoked') });
      await loadApiTokens();
    } catch (error: any) {
      showToast({ type: 'error', message: error.msg || t('userProfile.apiTokens.revokeFailed') });
    }
  };

  const handleRegenerateToken = async (tokenId: number) => {
    try {
      setGeneratingToken(true);
      const result = await regenerateApiToken(tokenId);
      setNewlyCreatedToken(result.tokenValue);
      setShowNewTokenModal(true);
      await loadApiTokens();
    } catch (error: any) {
      showToast({
        type: 'error',
        message: error.msg || t('userProfile.apiTokens.regenerateFailed'),
      });
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleCopyToken = () => {
    if (newlyCreatedToken) {
      navigator.clipboard
        .writeText(newlyCreatedToken)
        .then(() => {
          setTokenCopied(true);
          setTimeout(() => setTokenCopied(false), 2000);
        })
        .catch(() => {});
    }
  };

  const loadUserInfo = async (silent = false) => {
    try {
      if (!silent) setFetching(true);
      const res = await fetchCurrentUser();
      if (res && res.user) {
        setUserData(res.user);
        // 同步更新全局状态
        if (authUser) {
          setUser({ ...authUser, name: res.user.nickName || authUser.name });
        }
      }
    } catch {
      showToast({ type: 'error', message: t('userProfile.toast.fetchFailed') });
    } finally {
      if (!silent) setFetching(false);
    }
  };

  const handleEditProfile = async () => {
    try {
      setModalLoading(true);
      await loadUserInfo(true); // 静默刷新数据
      setIsProfileOpen(true);
    } finally {
      setModalLoading(false);
    }
  };

  // 获取头像URL
  const getAvatarUrl = () => {
    return userData?.avatar || null;
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showToast({ type: 'error', message: t('userProfile.avatar.invalidType') });
      return;
    }

    // 验证文件大小（5MB）
    if (file.size > 5 * 1024 * 1024) {
      showToast({ type: 'error', message: t('userProfile.avatar.tooLarge') });
      return;
    }

    try {
      setAvatarLoading(true);
      await uploadAvatar(file);
      showToast({ type: 'success', message: t('userProfile.avatar.uploaded') });
      await loadUserInfo(true); // 刷新用户信息
    } catch (error: any) {
      showToast({ type: 'error', message: error.msg || t('userProfile.avatar.uploadFailed') });
    } finally {
      setAvatarLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  useEffect(() => {
    loadUserInfo();
    loadApiTokens();
  }, [loadApiTokens]);

  useEffect(() => {
    if (userData?.tokenKey) {
      setFlowmeshKey(userData.tokenKey);
    }
  }, [userData]);

  const handleSaveFlowmeshKey = async () => {
    if (!flowmeshKey.trim()) return;
    try {
      setFlowmeshSaving(true);
      await updateUserProfile({ tokenKey: flowmeshKey.trim() });
      showToast({ type: 'success', message: t('userProfile.integrations.flowmesh.saved') });
      await loadUserInfo(true);
    } catch (error: any) {
      showToast({
        type: 'error',
        message: error.msg || t('userProfile.integrations.flowmesh.saveFailed'),
      });
    } finally {
      setFlowmeshSaving(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">{t('userProfile.title')}</h1>
        <p className="text-slate-500 mt-1">{t('userProfile.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* 基本信息卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="relative group">
                {getAvatarUrl() ? (
                  <img
                    src={getAvatarUrl()}
                    alt={userData?.nickName}
                    className="w-16 h-16 rounded-full object-cover border-2 border-brand-100 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={handleAvatarClick}
                  />
                ) : (
                  <div
                    className="w-16 h-16 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-2xl font-bold border-2 border-brand-100 cursor-pointer hover:bg-brand-100 transition-colors"
                    onClick={handleAvatarClick}
                  >
                    {userData?.nickName?.charAt(0)}
                  </div>
                )}
                {avatarLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 rounded-full">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                  </div>
                )}
                <div className="absolute bottom-0 right-0 w-5 h-5 bg-brand-600 rounded-full flex items-center justify-center border-2 border-white cursor-pointer hover:bg-brand-700 transition-colors opacity-0 group-hover:opacity-100">
                  <Icons.Edit className="w-3 h-3 text-white" />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">{userData?.nickName}</h2>
                <p className="text-sm text-slate-500">
                  {t('userProfile.accountId', { id: userData?.userId })}
                </p>
              </div>
            </div>
            <button
              onClick={handleEditProfile}
              disabled={fetching || modalLoading || !userData}
              className="flex items-center space-x-2 px-4 py-2 bg-slate-50 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-100 transition-colors border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {modalLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600"></div>
              ) : (
                <Icons.Edit className="w-4 h-4" />
              )}
              <span>
                {modalLoading
                  ? t('userProfile.editProfile.loading')
                  : t('userProfile.editProfile.button')}
              </span>
            </button>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-12">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center">
                <Icons.Users className="w-5 h-5 text-slate-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">{t('userProfile.field.username')}</p>
                <p className="text-sm font-medium text-slate-700">{userData?.userName}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center">
                <Icons.Smartphone className="w-5 h-5 text-slate-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">{t('userProfile.field.phone')}</p>
                <p className="text-sm font-medium text-slate-700">
                  {userData?.phonenumber || t('userProfile.unbound')}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center">
                <Icons.Mail className="w-5 h-5 text-slate-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">{t('userProfile.field.email')}</p>
                <p className="text-sm font-medium text-slate-700">
                  {userData?.email || t('userProfile.unbound')}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center">
                <Icons.Activity className="w-5 h-5 text-slate-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">{t('userProfile.field.gender')}</p>
                <p className="text-sm font-medium text-slate-700">
                  {userData?.sex === '0'
                    ? t('userProfile.gender.male')
                    : userData?.sex === '1'
                      ? t('userProfile.gender.female')
                      : t('userProfile.gender.secret')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 账户安全卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center space-x-2">
              <Icons.Lock className="w-5 h-5 text-brand-500" />
              <span>{t('userProfile.security.title')}</span>
            </h2>
          </div>
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
                <Icons.Shield className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">
                  {t('userProfile.security.password')}
                </p>
                <p className="text-xs text-slate-400">{t('userProfile.security.passwordHint')}</p>
              </div>
            </div>
            <button
              onClick={() => setIsPasswordOpen(true)}
              className="px-4 py-2 text-brand-600 bg-brand-50 rounded-lg text-sm font-medium hover:bg-brand-100 transition-colors"
            >
              {t('userProfile.security.changePassword')}
            </button>
          </div>
        </div>

        {/* FlowMesh 集成卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center space-x-2">
              <Icons.Zap className="w-5 h-5 text-brand-500" />
              <span>{t('userProfile.integrations.title')}</span>
            </h2>
          </div>
          <div className="p-6">
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icons.Globe className="w-5 h-5 text-violet-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-1">
                  <p className="text-sm font-medium text-slate-700">
                    {t('userProfile.integrations.flowmesh.title')}
                  </p>
                  {userData?.tokenKey ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
                      {t('userProfile.integrations.flowmesh.connected')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                      {t('userProfile.integrations.flowmesh.notConnected')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  {t('userProfile.integrations.flowmesh.description')}
                </p>
                <div className="flex items-center space-x-2">
                  <div className="relative flex-1">
                    <input
                      type={flowmeshKeyVisible ? 'text' : 'password'}
                      value={flowmeshKey}
                      onChange={(e) => setFlowmeshKey(e.target.value)}
                      placeholder={t('userProfile.integrations.flowmesh.placeholder')}
                      className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setFlowmeshKeyVisible(!flowmeshKeyVisible)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {flowmeshKeyVisible ? (
                        <Icons.X className="w-4 h-4" />
                      ) : (
                        <Icons.Activity className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <button
                    onClick={handleSaveFlowmeshKey}
                    disabled={flowmeshSaving || !flowmeshKey.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    {flowmeshSaving
                      ? t('userProfile.integrations.flowmesh.saving')
                      : userData?.tokenKey
                        ? t('userProfile.integrations.flowmesh.update')
                        : t('userProfile.integrations.flowmesh.save')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* API Tokens Card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center space-x-2">
              <Icons.Key className="w-5 h-5 text-brand-500" />
              <span>{t('userProfile.apiTokens.title')}</span>
            </h2>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => navigate('/app/api-docs')}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
              >
                {t('userProfile.apiTokens.viewDocs')}
              </button>
              <button
                onClick={() => {
                  setShowNewTokenModal(true);
                  setNewlyCreatedToken(null);
                  setNewTokenName('');
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors"
              >
                {t('userProfile.apiTokens.generate')}
              </button>
            </div>
          </div>
          <div className="p-6">
            <p className="text-xs text-slate-400 mb-4">{t('userProfile.apiTokens.description')}</p>

            {tokensLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600"></div>
              </div>
            ) : apiTokens.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400">
                {t('userProfile.apiTokens.empty')}
              </div>
            ) : (
              <div className="space-y-3">
                {apiTokens.map((token) => (
                  <div
                    key={token.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                        <Icons.Key className="w-4 h-4 text-slate-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">
                          {token.tokenName}
                        </p>
                        <p className="text-xs text-slate-400 font-mono">{token.tokenPrefix}...</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4 flex-shrink-0">
                      {token.lastUsedAt && (
                        <span className="text-xs text-slate-400">
                          {t('userProfile.apiTokens.lastUsed')}:{' '}
                          {new Date(token.lastUsedAt).toLocaleDateString()}
                        </span>
                      )}
                      <button
                        onClick={() => handleRegenerateToken(token.id)}
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                        title={t('userProfile.apiTokens.regenerate')}
                      >
                        <Icons.RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRevokeToken(token.id)}
                        className="text-xs text-red-500 hover:text-red-600 font-medium"
                        title={t('userProfile.apiTokens.revoke')}
                      >
                        <Icons.Trash className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Token Modal */}
      {showNewTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">
                {newlyCreatedToken
                  ? t('userProfile.apiTokens.tokenCreated')
                  : t('userProfile.apiTokens.generateTitle')}
              </h2>
              <button
                onClick={() => {
                  setShowNewTokenModal(false);
                  setNewlyCreatedToken(null);
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              {newlyCreatedToken ? (
                <div className="space-y-4">
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs font-medium text-amber-800">
                      {t('userProfile.apiTokens.copyWarning')}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      readOnly
                      value={newlyCreatedToken}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-slate-50 select-all"
                    />
                    <button
                      onClick={handleCopyToken}
                      className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors whitespace-nowrap"
                    >
                      {tokenCopied
                        ? t('userProfile.apiTokens.copied')
                        : t('userProfile.apiTokens.copy')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">
                      {t('userProfile.apiTokens.nameLabel')}
                    </label>
                    <input
                      type="text"
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                      placeholder={t('userProfile.apiTokens.namePlaceholder')}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                      maxLength={128}
                    />
                  </div>
                  <div className="flex justify-end space-x-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowNewTokenModal(false)}
                      className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                    >
                      {t('dialog.cancel')}
                    </button>
                    <button
                      onClick={handleGenerateToken}
                      disabled={generatingToken || !newTokenName.trim()}
                      className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50"
                    >
                      {generatingToken
                        ? t('userProfile.apiTokens.generating')
                        : t('userProfile.apiTokens.generate')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ProfileEditModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        initialData={{
          nickName: userData?.nickName || '',
          sex: userData?.sex || '0',
          phonenumber: userData?.phonenumber || '',
          email: userData?.email || '',
        }}
        onSuccess={loadUserInfo}
      />

      <PasswordEditModal isOpen={isPasswordOpen} onClose={() => setIsPasswordOpen(false)} />

      {toastContainer()}
    </div>
  );
};
