import axios, { type AxiosInstance, type AxiosResponse, AxiosError } from "axios";
import { API_BASE_URL } from "../config/env";
import type { ErrorResponse } from "./types";

export class ApiError extends Error {
  ret_code: number;
  response?: AxiosResponse;
  constructor(ret_code: number, message: string, response?: AxiosResponse) {
    super(message);
    this.name = "ApiError";
    this.ret_code = ret_code;
    this.response = response;
  }
}

// One axios instance used site-wide. withCredentials so the .lum.id
// lm_session cookie rides on every call — we never touch localStorage
// because the cookie is HttpOnly by design.
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
  paramsSerializer: { indexes: null },
});

// Normalize LQA's ret_code envelope into a thrown ApiError, and
// surface 401 cleanly so calling code can tell "bad input" from
// "session gone".
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    if (
      response.data &&
      typeof response.data === "object" &&
      "ret_code" in response.data
    ) {
      const { ret_code, message } = response.data as ErrorResponse;
      if (ret_code !== 0) {
        throw new ApiError(ret_code, message || "Request failed", response);
      }
    }
    return response;
  },
  (error: AxiosError<ErrorResponse>) => {
    if (error.response?.status === 401) {
      return Promise.reject(new ApiError(401, "unauthenticated", error.response));
    }
    const data = error.response?.data;
    if (data && typeof data === "object" && "ret_code" in data) {
      return Promise.reject(
        new ApiError(data.ret_code as number, data.message || error.message, error.response)
      );
    }
    return Promise.reject(
      new ApiError(error.response?.status || -1, error.message, error.response)
    );
  }
);

export default apiClient;
