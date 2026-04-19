/**
 * 生成类似 n8n 的短 ID（如 lMlMy4G3sXTQwM7q）
 * @param {number} length - ID 长度，默认 16
 * @returns {string} 生成的 ID
 */
export function generateWorkflowId(length = 16) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';

  // 使用 crypto.getRandomValues 生成更安全的随机数
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < length; i++) {
    result += charset[randomValues[i] % charset.length];
  }

  return result;
}

/**
 * 判断节点是否为活跃状态
 * 根据 GpuNodeAPITypeEnum 定义，除了 STOPPING（停车）和 STOPPED（停止）状态外，其他状态均算活跃
 * 活跃状态包括：STARTING（开始）、BUSY（忙碌）、IDLE（空闲）
 * @param {string} status - 节点状态
 * @returns {boolean} 是否为活跃节点
 */
export function isActiveNode(status?: string): boolean {
  if (!status) return false;
  // 排除 STOPPING 和 STOPPED 状态，其他状态均算活跃
  return status !== 'STOPPING' && status !== 'STOPPED';
}
