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
    if (error.response?.status === 401) {
      // On Lumilake-side 401, route back to lum.id auth — the session
      // the user needs is the lum.id session, not Lumilake's own.
      localStorage.removeItem('authToken');
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);

export default api;
