import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, UserRole } from '@/runmesh/types';
import { translate } from '@/runmesh/i18n';
import {
  fetchCurrentUser as fetchCurrentUserApi,
  login as loginApi,
  logout as logoutApi,
  phoneLogin as phoneLoginApi,
  register as registerApi,
  LoginPayload,
  LoginResult,
  PhoneLoginPayload,
  RegisterPayload,
} from '../api/user/auth';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  hasFetchedUser: boolean;
  hasHydrated: boolean;
  loading: boolean;
  loginAsRole: (role: UserRole) => void;
  login: (payload: LoginPayload) => Promise<User | null>;
  phoneLogin: (payload: PhoneLoginPayload) => Promise<User | null>;
  register: (payload: RegisterPayload) => Promise<User | null>;
  socialLogin: (payload: {
    source: string;
    socialCode: string;
    socialState: string;
  }) => Promise<User | null>;
  fetchUser: () => Promise<User | null>;
  logout: (options?: { skipRequest?: boolean }) => Promise<void>;
  setUser: (user: User | null) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

const STORAGE_KEYS = {
  TOKEN: 'auth-token',
};

const pickToken = (res: any): string | null => res?.token || res?.access_token || null;
const mapToUser = (u: any, rolesFromResponse?: any[]): User | null => {
  if (!u || typeof u !== 'object') {
    console.warn('无效的用户数据:', u);
    return null;
  }

  let rawRole = u.role;

  if (!rawRole) {
    const rolesToCheck = rolesFromResponse || u.roles;

    if (rolesToCheck) {
      if (Array.isArray(rolesToCheck) && rolesToCheck.length > 0) {
        const hasAdminRole = rolesToCheck.some((r: any) => {
          const roleStr = String(r).toLowerCase();
          return roleStr === 'admin' || roleStr === 'super' || roleStr.includes('admin');
        });
        rawRole = hasAdminRole ? 'admin' : rolesToCheck[0];
      } else if (typeof rolesToCheck === 'string') {
        rawRole = rolesToCheck;
      }
    }
  }

  if (!rawRole) {
    if (u.userType) {
      rawRole = u.userType;
    } else if (u.roleId) {
      rawRole = u.roleId;
    } else if (u.roleKey) {
      if (Array.isArray(u.roleKey) && u.roleKey.length > 0) {
        rawRole = u.roleKey[0];
      } else if (typeof u.roleKey === 'string') {
        rawRole = u.roleKey;
      }
    }
  }

  const roleStr = String(rawRole || '').toLowerCase();
  const role =
    roleStr === 'admin' ||
    roleStr === 'super' ||
    roleStr.includes('admin') ||
    roleStr === 'sys_admin'
      ? 'ADMIN'
      : 'USER';

  // 确保ID不为空
  const userId = String(u.userId ?? u.id ?? '');
  if (!userId) {
    console.warn('用户ID为空');
    return null;
  }

  return {
    id: userId,
    name: u.userName ?? u.username ?? u.nickName ?? translate('common.unknownUser'),
    email: u.email ?? '',
    role: role as UserRole,
    amount: Number(u.amount) || 0,
  };
};

const mockProfiles: Record<UserRole, User> = {
  [UserRole.USER]: {
    id: 'u_01',
    name: 'Alex Developer',
    email: 'alex@techcorp.com',
    role: UserRole.USER,
    amount: 450,
  },
  [UserRole.ADMIN]: {
    id: 'u_99',
    name: 'System Administrator',
    email: 'admin@flowmesh.ai',
    role: UserRole.ADMIN,
    amount: 450,
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      hasFetchedUser: false,
      hasHydrated: false,
      loading: false,
      loginAsRole: (role) => {
        const profile = mockProfiles[role];
        const token = `mock-token-${role.toLowerCase()}`;
        set({ user: profile, token, isAuthenticated: true, hasFetchedUser: true });
      },
      login: async (payload) => {
        set({ loading: true });
        try {
          const res: LoginResult = await loginApi(payload);

          const token = pickToken(res);
          if (!token) {
            throw new Error(translate('error.loginFailed'));
          }

          localStorage.setItem(STORAGE_KEYS.TOKEN, token);

          // 优先尝试从登录返回结果中获取用户信息
          if (res.user) {
            const rolesFromResponse = (res as any).roles;
            const mapped = mapToUser(res.user, rolesFromResponse);
            if (mapped) {
              set({
                user: mapped,
                token,
                isAuthenticated: true,
                hasFetchedUser: true,
              });
              return mapped;
            }
          }

          // 如果登录结果没有用户信息，则主动获取
          // 直接调用 API 避免多次状态更新触发 App 组件的重复获取
          const userResp = await fetchCurrentUserApi();
          const userData: any = userResp?.user || userResp;
          const rolesFromResponse = userResp?.roles;
          const mapped = mapToUser(userData, rolesFromResponse);

          if (mapped) {
            set({ user: mapped, token, isAuthenticated: true, hasFetchedUser: true });
            return mapped;
          }

          // 如果获取失败但没有报错（如空数据），仅设置 token
          set({ token, hasFetchedUser: true });
          return null;
        } catch (error) {
          await get().logout({ skipRequest: true });
          throw error;
        } finally {
          set({ loading: false });
        }
      },

      fetchUser: async () => {
        const token = get().token || localStorage.getItem(STORAGE_KEYS.TOKEN);
        if (!token) return null;

        try {
          const resp = await fetchCurrentUserApi();

          const userData: any = resp?.user || resp;
          const rolesFromResponse = resp?.roles;
          const mapped = mapToUser(userData, rolesFromResponse);
          if (mapped) {
            set({ user: mapped, isAuthenticated: true, hasFetchedUser: true });
            return mapped;
          }
          set({ hasFetchedUser: true });
          return null;
        } catch {
          await get().logout({ skipRequest: true });
          set({ hasFetchedUser: true });
          return null;
        }
      },

      phoneLogin: async (payload) => {
        set({ loading: true });
        try {
          const res: LoginResult = await phoneLoginApi(payload);
          const token = pickToken(res);
          if (!token) {
            throw new Error(translate('error.loginFailed'));
          }

          localStorage.setItem(STORAGE_KEYS.TOKEN, token);

          // 优先尝试从登录返回结果中获取用户信息
          if (res.user) {
            const rolesFromResponse = (res as any).roles;
            const mapped = mapToUser(res.user, rolesFromResponse);
            if (mapped) {
              set({
                user: mapped,
                token,
                isAuthenticated: true,
                hasFetchedUser: true,
              });
              return mapped;
            }
          }

          // 如果登录结果没有用户信息，则主动获取
          const userResp = await fetchCurrentUserApi();
          const userData: any = userResp?.user || userResp;
          const rolesFromResponse = userResp?.roles;
          const mapped = mapToUser(userData, rolesFromResponse);

          if (mapped) {
            set({ user: mapped, token, isAuthenticated: true, hasFetchedUser: true });
            return mapped;
          }

          set({ token, hasFetchedUser: true });
          return null;
        } catch (error) {
          await get().logout({ skipRequest: true });
          throw error;
        } finally {
          set({ loading: false });
        }
      },

      register: async (payload) => {
        set({ loading: true });
        try {
          const res = await registerApi(payload);

          const loginResult = res as LoginResult | void;
          const directToken = loginResult ? pickToken(loginResult) : null;
          if (loginResult && directToken) {
            const { user } = loginResult as LoginResult;
            const rolesFromResponse = (loginResult as any).roles;
            localStorage.setItem(STORAGE_KEYS.TOKEN, directToken);
            const mapped = mapToUser(user, rolesFromResponse);
            if (mapped) {
              set({
                user: mapped,
                token: directToken,
                isAuthenticated: true,
                hasFetchedUser: true,
              });
              return mapped;
            }

            // 如果有 token 但没有有效 user，主动 fetch 避免重复触发
            const userResp = await fetchCurrentUserApi();
            const userData: any = userResp?.user || userResp;
            const fetchedRoles = userResp?.roles;
            const fetchedUser = mapToUser(userData, fetchedRoles);

            if (fetchedUser) {
              set({
                user: fetchedUser,
                token: directToken,
                isAuthenticated: true,
                hasFetchedUser: true,
              });
              return fetchedUser;
            }

            set({ token: directToken, hasFetchedUser: true });
            return null;
          }

          const user = await get().login({
            username: payload.username,
            password: payload.password,
          });
          return user;
        } catch (error) {
          await get().logout({ skipRequest: true });
          throw error;
        } finally {
          set({ loading: false });
        }
      },

      socialLogin: async (payload) => {
        set({ loading: true });
        try {
          const loginPayload = {
            grantType: 'social',
            source: payload.source,
            socialCode: payload.socialCode,
            socialState: payload.socialState,
            clientId: import.meta.env.VITE_CLIENT_ID || 'default',
          };

          const res: LoginResult = await loginApi(loginPayload as any);
          const token = pickToken(res);
          if (!token) throw new Error(translate('error.loginFailed'));

          localStorage.setItem(STORAGE_KEYS.TOKEN, token);

          if (res.user) {
            const mapped = mapToUser(res.user, (res as any).roles);
            if (mapped) {
              set({ user: mapped, token, isAuthenticated: true, hasFetchedUser: true });
              return mapped;
            }
          }

          const userResp = await fetchCurrentUserApi();
          const mapped = mapToUser(userResp?.user || userResp, userResp?.roles);
          if (mapped) {
            set({ user: mapped, token, isAuthenticated: true, hasFetchedUser: true });
            return mapped;
          }
          return null;
        } catch (error) {
          await get().logout({ skipRequest: true });
          throw error;
        } finally {
          set({ loading: false });
        }
      },

      logout: async (options) => {
        const skipRequest = options?.skipRequest;
        try {
          if (!skipRequest) {
            await logoutApi();
          }
        } catch (error) {
          console.error('logout failed', error);
        } finally {
          localStorage.removeItem(STORAGE_KEYS.TOKEN);
          set({ user: null, token: null, isAuthenticated: false, hasFetchedUser: false });
        }
      },

      setUser: (user) => {
        set({ user, isAuthenticated: !!user, hasFetchedUser: !!user });
      },
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
