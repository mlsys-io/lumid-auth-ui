// Minimal auth-focused surface for lum.id. We don't re-export the
// competition/strategy/etc. APIs that the QuantArena frontend ships —
// lum.id's scope is identity + landing page only. Downstream apps
// hit their own domains for product APIs.
export * from './auth';
export * from './user';
export * from './types';
export { default as apiClient, ApiError } from './client';
