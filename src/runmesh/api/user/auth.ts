import { httpUser as http } from '../../utils/axios';
import { User } from '@/runmesh/types';

const CLIENT_ID = import.meta.env.VITE_CLIENT_ID || '';
const GRANT_TYPE = import.meta.env.VITE_GRANT_TYPE || 'password';
const TENANT_ID = import.meta.env.VITE_TENANT_ID || '';

export interface LoginPayload {
  username: string;
  password?: string;
  captcha?: string;
  code?: string;
  uuid?: string;
  channelId?: string;
  teamId?: string;
  inviteCode?: string;
  tenantId?: string;
}

export interface LoginResult {
  user: User;
  token: string;
  refreshToken?: string;
}

export const login = (payload: LoginPayload) => {
  const body = {
    clientId: CLIENT_ID,
    tenantId: payload.tenantId || TENANT_ID,
    grantType: GRANT_TYPE,
    ...payload,
  };
  return http.post<LoginResult>('/auth/login', body, {
    isToken: false,
    encrypt: true,
  });
};

export const fetchCurrentUser = () => http.get<any>('/system/user/getInfo');

export const logout = () => http.post<void>('/auth/logout');

export const refreshToken = (refreshToken: string) =>
  http.post<LoginResult>('/auth/refresh', { refreshToken });

export interface PhoneLoginPayload {
  phonenumber: string;
  smsCode: string;
  countryCode?: string;
  channelId?: string;
  teamId?: string;
  inviteCode?: string;
  registerTag?: string;
  tenantId?: string;
}

export const phoneLogin = (payload: PhoneLoginPayload) => {
  const body = {
    ...payload,
    clientId: CLIENT_ID,
    grantType: 'sms',
    tenantId: payload.tenantId || TENANT_ID,
  };
  return http.post<LoginResult>('/auth/login', body, {
    isToken: false,
    encrypt: true,
  });
};

export interface RegisterPayload {
  username: string;
  phoneNumber: string;
  code: string;
  password: string;
  confirmPassword: string;
  channelId?: string;
  teamId?: string;
  inviteCode?: string;
  tenantId?: string;
  userType?: string;
  registerSystem?: string;
}

export const register = (payload: RegisterPayload) => {
  const body = {
    ...payload,
    clientId: CLIENT_ID,
    grantType: 'password',
    tenantId: payload.tenantId || TENANT_ID,
    userType: payload.userType || 'sys_user',
    registerSystem: payload.registerSystem || '1',
  };
  return http.post<LoginResult | void>('/auth/register', body, {
    isToken: false,
    encrypt: true,
  });
};

export interface SocialCallbackPayload {
  source: string;
  socialCode: string;
  socialState: string;
}

/**
 * 获取三方登录跳转地址
 * @param source github / google / ...
 */
export const getSocialAuthorizeUrl = (source: string, domain?: string) =>
  http.get<string>(`/auth/binding/${source}`, {
    params: { domain: domain || window.location.origin },
    isToken: false,
  });

/**
 * 三方登录回调处理（需要后端根据实现决定是否要求已登录态）
 */
export const socialLoginCallback = (payload: SocialCallbackPayload) =>
  http.post<void>('/auth/social/callback', payload);

export const sendSmsCode = (
  phonenumber: string,
  options?: { type?: number; checkUser?: boolean; countryCode?: string },
) =>
  http.get<void>('/resource/sms/code', {
    params: {
      phonenumber,
      type: options?.type ?? 1,
      checkUser: options?.checkUser ?? false,
      ...(options?.countryCode ? { countryCode: options.countryCode } : {}),
    },
    isToken: false,
  });
