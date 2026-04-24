import api from '../config/axios';
import { AxiosRequestConfig, AxiosError } from "axios";

// OSS Lumilake is a strict subset of cloud Lumilake. 404s here are
// almost always "that feature lives only in cloud" rather than bugs.
// Swallow them at the service layer so pages render their own empty
// state without producing uncaught-promise errors. The browser's
// Network panel will still surface the 404 (that's native Chrome
// behaviour, not suppressible from JS); what we stop is the JS throw.
const emptyEnvelope = <T>(): T =>
  ({ code: 0, data: [], message: 'feature not available on this Lumilake endpoint' } as unknown) as T;

const handle404AsEmpty = <T>(err: AxiosError, mockResponse?: any): T => {
  if (mockResponse) return mockResponse as T;
  const status = err?.response?.status;
  // 404 → endpoint not in OSS. 401 → OSS auth is on but no JWT key
  // wired up yet (the shared-secret path in Lumilake OSS fails with
  // 500 when JWT_SECRET_KEY is empty, so any bearer is useless until
  // that's configured). Both should surface as "nothing here yet" in
  // the UI rather than as red-alert errors.
  if (status === 404 || status === 401) return emptyEnvelope<T>();
  throw new Error(`API request failed with status error`);
};

export const apiService = {
  get: <T>(url: string, config?: AxiosRequestConfig, mockResponse?: any) =>
    api.get<T>(url, config).then((res) => res.data as T).catch((err: AxiosError) =>
      handle404AsEmpty<T>(err, mockResponse)),

  post: <T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig) =>
    api.post<T>(url, data, config).then((res) => res.data as T).catch((err: AxiosError) =>
      handle404AsEmpty<T>(err)),

  put: <T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig) =>
    api.put<T>(url, data, config).then((res) => res.data as T).catch((err: AxiosError) =>
      handle404AsEmpty<T>(err)),

  patch: <T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig) =>
    api.patch<T>(url, data, config).then((res) => res.data as T).catch((err: AxiosError) =>
      handle404AsEmpty<T>(err)),

  delete: <T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig) =>
    api.delete<T>(url, { ...config, data }).then((res) => res.data as T).catch((err: AxiosError) =>
      handle404AsEmpty<T>(err)),

  upload: <T>(url: string, formData: FormData, config?: AxiosRequestConfig) =>
    api.post<T>(url, formData, {
      ...config,
      headers: { ...(config?.headers || {}), "Content-Type": "multipart/form-data" },
    } as AxiosRequestConfig).then((res) => res.data as T).catch((err: AxiosError) =>
      handle404AsEmpty<T>(err)),
};