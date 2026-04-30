# API Documentation

This directory contains all API service modules for the Trading Community Frontend.

## Structure

- `client.ts` - Axios client configuration with interceptors
- `types.ts` - TypeScript type definitions for all API requests/responses
- `auth.ts` - Authentication endpoints (login, register, OAuth)
- `user.ts` - User management endpoints
- `strategy.ts` - Strategy management endpoints
- `backtesting.ts` - Backtesting task endpoints
- `ranking.ts` - Strategy ranking endpoints
- `index.ts` - Central export file for all API functions

## Usage

### Import API functions

```typescript
import { login, getStrategies, createBacktestingTask } from '@/api';
```

### Authentication

```typescript
// Login
const loginData = await login({
  username: 'user@example.com',
  password: 'password123'
});

// Store token
localStorage.setItem('access_token', loginData.token);

// Logout
await logout();
```

### Strategies

```typescript
// Get strategy list with filters
const response = await getStrategies({
  page: 1,
  page_size: 20,
  framework: ['Moonshot', 'Zipline'],
  visibility: ['Public']
});

// Create new strategy
const newStrategy = await createStrategy({
  name: 'My Strategy',
  description: 'Description here',
  tags: 'tag1,tag2',
  framework: 'Moonshot',
  visibility: 'Private',
  file: pythonFile
});

// Update strategy
await updateStrategy(strategyId, {
  name: 'Updated Name',
  visibility: 'Public'
});

// Get strategy versions
const versions = await getStrategyVersions(strategyId);

// Export strategy code
const blob = await exportStrategyCode(strategyId, versionId);
```

### Backtesting

```typescript
// Create backtest task
const task = await createBacktestingTask({
  strategy_id: 123,
  start_date: 1609459200, // Unix timestamp
  end_date: 1640995200
});

// Get backtest tasks
const tasks = await getBacktestingTasks({
  page: 1,
  page_size: 20,
  status: ['Finished', 'Running']
});

// Get task result
const result = await getBacktestingTaskResult(taskId);

// Cancel task
await cancelBacktestingTask(taskId);

// Export result
const csvBlob = await exportBacktestingResult(taskId, 'csv');
```

### Ranking

```typescript
// Get strategy ranking
const rankings = await getStrategyRanking({
  page: 1,
  page_size: 50,
  sort_by: 'cagr',
  order: 'desc'
});
```

### User Management

```typescript
// Get current user info
const user = await getUserInfo();

// Update user info
const updated = await updateUserInfo({
  username: 'newname',
  email: 'new@example.com',
  avatar: 'base64_encoded_image'
});
```

## Authentication

All authenticated endpoints automatically include the JWT token from localStorage (`access_token`).

If a 401 Unauthorized response is received, the user will be automatically redirected to the login page.

## Error Handling

The API client automatically checks the `ret_code` field in responses. If `ret_code !== 0`, an `ApiError` is thrown.

```typescript
import { ApiError } from '@/api';
import { AxiosError } from 'axios';

try {
  const data = await getStrategies();
} catch (error) {
  if (error instanceof ApiError) {
    // Handle API errors with ret_code !== 0
    console.error('API Error:', error.message);
    console.error('Error Code:', error.ret_code);
  } else if (error instanceof AxiosError) {
    // Handle network errors, timeouts, etc.
    console.error('Network Error:', error.message);
  }
}
```

### ApiError Properties

- `ret_code: number` - The error code from the API response
- `message: string` - The error message from the API response
- `response?: AxiosResponse` - The original axios response (optional)

## Base URL Configuration

Set the `VITE_API_BASE_URL` environment variable to configure the API base URL:

```
VITE_API_BASE_URL=http://localhost:8080
```
