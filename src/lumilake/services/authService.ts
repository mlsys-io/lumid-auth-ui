import type { LoginRequest, LoginResponse } from '../types/user';

/**
 * Authentication service.
 * OSS mode: accepts any credentials and creates a local session.
 * Cloud mode: connect to Runmesh backend auth API.
 */
export const authService = {
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    const name = credentials.email.split('@')[0] || 'User';
    return {
      user: {
        id: '1',
        email: credentials.email,
        name,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=ffffff`,
        role: 'admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      token: `local-session-${Date.now()}`,
      refreshToken: `local-refresh-${Date.now()}`,
    };
  },

  logout: async (): Promise<void> => {},

  refreshToken: async (refreshToken: string): Promise<{ token: string; refreshToken: string }> => {
    if (!refreshToken) throw new Error('Invalid refresh token');
    return {
      token: `local-session-${Date.now()}`,
      refreshToken: `local-refresh-${Date.now()}`,
    };
  },
};
