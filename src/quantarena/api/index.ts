// Export all API functions
export * from './auth';
export * from './user';
export * from './strategy';
export * from './backtesting';
export * from './ranking';
export * from './dashboard';
export * from './datasource';
export * from './competition';
export * from './freqtrade';
export * from './flowmesh-jobs';

// Export types
export * from './types';

// Export client and error class for advanced usage
export { default as apiClient, ApiError } from './client';
