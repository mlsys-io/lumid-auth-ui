import axios, { AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import type { ApiError } from '../types/api';
import { useEndpointStore } from '../store/useEndpointStore';

const api = axios.create({
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Dynamically set baseURL from endpoint store
    const { activeUrl } = useEndpointStore.getState();
    config.baseURL = activeUrl;

    const apiKey = import.meta.env.VITE_API_KEY;
    if (apiKey && config.headers) {
      config.headers.Authorization = `Bearer ${apiKey}`;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error: AxiosError<ApiError>) => {
    // Lumilake has its own auth realm (bearer token). A 401 there is
    // NOT equivalent to a lum.id session expiry — it just means the
    // Lumilake credential isn't configured yet (OSS dev has no token;
    // cloud needs a key the user hasn't wired up). Bouncing to
    // /auth/login on every Lumilake 401 made /dashboard/lumilake/*
    // unusable. Let the caller decide: service layer already swallows
    // errors and renders empty states.
    return Promise.reject(error);
  }
);

export default api;
