/**
 * API rate limiter
 * Limits API call frequency (1-2 requests per second)
 */

import { translate } from '@/runmesh/i18n';

interface RequestRecord {
  url: string;
  timestamp: number;
}

class ApiRateLimiter {
  private requests: RequestRecord[] = [];
  private readonly timeWindowMs: number = 1000; // 1秒时间窗口
  private readonly maxRequestsPerUrl: number = 1; // 每个URL每秒最多1个请求
  private readonly minIntervalAfterRequest: number = 1000; // 请求完成后至少等待1秒(1000毫秒)
  private lastRequests: Map<string, number> = new Map(); // 记录每个URL的最后请求时间
  private refreshAllowed: Map<string, boolean> = new Map(); // 记录是否允许刷新（用户主动操作）

  /**
   * 检查是否允许执行请求
   * @param url 请求的URL
   * @returns 是否允许请求
   */
  public canMakeRequest(url: string): boolean {
    const now = Date.now();

    // 检查是否距离上次请求已超过最小间隔时间
    const lastRequestTime = this.lastRequests.get(url) || 0;
    const timeSinceLastRequest = now - lastRequestTime;

    // 如果是用户主动刷新，则允许立即请求
    const isRefreshAllowed = this.refreshAllowed.get(url) || false;

    if (!isRefreshAllowed && timeSinceLastRequest < this.minIntervalAfterRequest) {
      return false;
    }

    // 清理时间窗口外的请求记录
    this.requests = this.requests.filter((record) => now - record.timestamp < this.timeWindowMs);

    // 检查当前时间窗口内相同URL的请求数量
    const urlRequests = this.requests.filter((record) => record.url === url);

    // 如果相同URL的请求数已达到上限，则不允许
    if (urlRequests.length >= this.maxRequestsPerUrl) {
      return false;
    }

    return true;
  }

  /**
   * 记录请求
   * @param url 请求的URL
   */
  public recordRequest(url: string): void {
    const timestamp = Date.now();

    this.requests.push({
      url,
      timestamp,
    });

    // 记录最后请求时间
    this.lastRequests.set(url, timestamp);

    // 重置刷新状态
    this.refreshAllowed.set(url, false);
  }

  /**
   * 带频率限制的请求包装器
   * @param requestFn 实际的请求函数
   * @param url 请求的URL
   * @returns 请求结果或错误
   */
  public async makeRequestWithLimit<T>(requestFn: () => Promise<T>, url: string): Promise<T> {
    if (!this.canMakeRequest(url)) {
      throw new Error(translate('error.tooManyAttempts'));
    }

    this.recordRequest(url);
    return requestFn();
  }

  /**
   * 重置限制器状态（主要用于测试）
   */
  public reset(): void {
    this.requests = [];
  }

  /**
   * 允许对特定URL进行刷新（绕过30秒限制）
   * @param url 请求的URL
   */
  public allowRefresh(url: string): void {
    this.refreshAllowed.set(url, true);
  }
}

// 创建全局单例
export const apiRateLimiter = new ApiRateLimiter();

/**
 * 允许对特定URL进行刷新（绕过30秒限制）
 * @param url 请求的URL
 */
export const allowRefresh = (url: string): void => {
  apiRateLimiter.allowRefresh(url);
};

/**
 * 用于包装API请求的高阶函数
 * @param requestFn 实际的请求函数
 * @param url 请求的URL
 * @returns 包装后的请求函数
 */
export const withRateLimit = <T>(requestFn: () => Promise<T>, url: string): Promise<T> => {
  return apiRateLimiter.makeRequestWithLimit(requestFn, url);
};

/**
 * 用于包装API请求的异步函数
 * 如果频率超限，会等待一段时间后重试
 * @param requestFn 实际的请求函数
 * @param url 请求的URL
 * @param maxRetries 最大重试次数
 * @returns 请求结果
 */
export const withRateLimitRetry = async <T>(
  requestFn: () => Promise<T>,
  url: string,
  maxRetries: number = 3,
): Promise<T> => {
  let retries = 0;

  while (retries < maxRetries) {
    if (apiRateLimiter.canMakeRequest(url)) {
      apiRateLimiter.recordRequest(url);
      return await requestFn();
    }

    retries++;

    if (retries >= maxRetries) {
      throw new Error(translate('error.tooManyAttempts'));
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(translate('error.requestFailed'));
};
