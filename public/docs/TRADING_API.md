# Trading API Documentation

## Overview

The Trading API provides endpoints for algorithmic trading strategies to interact with the trading simulation platform. These APIs allow strategies to submit orders, query account information, check positions, and retrieve trade history.

**Base URL**: `https://lumid.market/trading` (or configured trading port)

**Authentication**: All endpoints require API token authentication via the `X-API-Token` header.

## Authentication

### API Token Format

```
X-API-Token: Bearer <your_api_token>
```

The API token is generated when you create a simulation strategy and join a competition. The token is unique to each simulation strategy and is only valid when the strategy is actively competing.

### Authentication Requirements

- Token must be provided in the `X-API-Token` header
- Format: `Bearer <token>`
- Strategy must be in "Competing" status
- Strategy must be associated with an active competition

### Error Responses

**Important**: All API responses return HTTP 200 OK. Errors are indicated by non-zero `ret_code` values in the response body.

**401 Unauthorized** - Invalid or missing token

```json
{
	"ret_code": 401,
	"message": "Invalid API token"
}
```

**403 Forbidden** - Strategy not in competition

```json
{
	"ret_code": 403,
	"message": "Strategy is not currently in a competition"
}
```

---

## Endpoints

### 1. Submit Trading Order

Submit a buy or sell order for a specific symbol.

**Endpoint**: `POST /api/custom/trading/order`

**Request Body**:

```json
{
	"symbol": "AAPL",
	"direction": "Buy",
	"volume": 100
}
```

**Request Parameters**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| symbol | string | Yes | Stock symbol (e.g., "AAPL", "GOOGL") |
| direction | string | Yes | Trade direction: "Buy" or "Sell" |
| volume | integer | Yes | Number of shares (must be > 0) |

**Response** (200 OK):

```json
{
	"ret_code": 0,
	"message": "Order submitted successfully",
	"data": {
		"order_id": 12345,
		"symbol": "AAPL",
		"direction": "Buy",
		"price": 150.25,
		"volume": 100,
		"value": 15025.0,
		"trade_time": 1704672000
	}
}
```

**Response Fields**:
| Field | Type | Description |
|-------|------|-------------|
| order_id | integer | Unique order ID |
| symbol | string | Stock symbol |
| direction | string | Trade direction (Buy/Sell) |
| price | float | Execution price |
| volume | integer | Number of shares traded |
| value | float | Total trade value (price × volume) |
| trade_time | integer | Trade execution time (unix timestamp in seconds) |

**Error Responses**:

**Note**: All responses return HTTP 200 OK. Check the `ret_code` field to determine success (0) or error (non-zero).

Common error codes:
- `1400` - Competition not active
- `1401` - Market closed
- `1404` - Symbol not available in market
- `1405` - Insufficient cash
- `1406` - Insufficient position
- `401` - Unauthorized
- `403` - Forbidden
- `5000` - Database error
- `5200` - External service error

---

### 2. Get Account Information

Retrieve current account information including equity, cash, positions, and performance metrics.

**Endpoint**: `GET /api/custom/trading/account`

**Response** (200 OK):

```json
{
	"ret_code": 0,
	"message": "Account info retrieved successfully",
	"data": {
		"participant_id": 789,
		"total_equity": 105250.5,
		"available_cash": 45000.0,
		"position_value": 60250.5,
		"return_rate": 0.0525,
		"max_drawdown": 0.0123,
		"sharpe_ratio": 1.85,
		"trading_times": 42
	}
}
```

**Response Fields**:
| Field | Type | Description |
|-------|------|-------------|
| participant_id | integer | Competition participant ID |
| total_equity | float | Total account equity (cash + positions) |
| available_cash | float | Available cash for trading |
| position_value | float | Total value of current positions |
| return_rate | float | Return rate (decimal, e.g., 0.0525 = 5.25%) |
| max_drawdown | float | Maximum drawdown (decimal, e.g., 0.0123 = 1.23%) |
| sharpe_ratio | float | Sharpe ratio (annualized, dimensionless) |
| trading_times | integer | Total number of trades executed |

**Important Note - Completed Competitions**:

For completed competitions, the account data is **frozen** and based on the final daily snapshot taken at competition end. This means:

- Account metrics reflect the final state at competition end time
- Data does not change with current market prices
- This ensures final rankings and results remain stable after competition ends

For ongoing competitions, account data is calculated in real-time using current market prices.

---

### 3. Get Current Positions

Retrieve all current open positions.

**Endpoint**: `GET /api/custom/trading/positions`

**Response** (200 OK):

```json
{
	"ret_code": 0,
	"message": "Positions retrieved successfully",
	"data": [
		{
			"symbol": "AAPL",
			"position_size": 100,
			"average_price": 148.5,
			"market_price": 150.25,
			"unrealized_pnl": 175.0
		},
		{
			"symbol": "GOOGL",
			"position_size": 50,
			"average_price": 2800.0,
			"market_price": 2850.0,
			"unrealized_pnl": 2500.0
		}
	]
}
```

**Response Fields** (per position):
| Field | Type | Description |
|-------|------|-------------|
| symbol | string | Stock symbol |
| position_size | integer | Number of shares held |
| average_price | float | Average purchase price |
| market_price | float | Current market price |
| unrealized_pnl | float | Unrealized profit/loss |

**Important Note - Completed Competitions**:

For completed competitions, this endpoint returns an **empty array** `[]`. Position data is not available after competition ends since:

- All positions are considered closed at competition end
- Final account metrics are frozen in the daily snapshot
- This prevents confusion about position values after competition ends

For ongoing competitions, this endpoint returns real-time position data with current market prices.

---

### 4. Get Trade History

Retrieve historical trades with pagination.

**Endpoint**: `GET /api/custom/trading/trades`

**Query Parameters**:
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| competition_id | integer | Yes | - | Competition ID |
| simulation_strategy_id | integer | Yes | - | Simulation strategy ID |
| page | integer | No | 1 | Page number (min: 1) |
| page_size | integer | No | 20 | Page size (min: 1, max: 100) |

**Example Request**:

```
GET /api/custom/trading/trades?competition_id=123&simulation_strategy_id=456&page=1&page_size=20
```

**Response** (200 OK):

```json
{
	"ret_code": 0,
	"message": "Trades retrieved successfully",
	"data": [
		{
			"id": 1001,
			"symbol": "AAPL",
			"direction": "Buy",
			"price": 150.25,
			"volume": 100,
			"value": 15025.0,
			"trade_time": 1704672000
		},
		{
			"id": 1002,
			"symbol": "GOOGL",
			"direction": "Sell",
			"price": 2850.0,
			"volume": 50,
			"value": 142500.0,
			"trade_time": 1704675600
		}
	],
	"total": 42
}
```

**Response Fields**:
| Field | Type | Description |
|-------|------|-------------|
| data | array | Array of trade records |
| total | integer | Total number of trades (for pagination) |

**Trade Record Fields**:
| Field | Type | Description |
|-------|------|-------------|
| id | integer | Trade ID |
| symbol | string | Stock symbol |
| direction | string | Trade direction (Buy/Sell) |
| price | float | Execution price |
| volume | integer | Number of shares traded |
| value | float | Total trade value |
| trade_time | integer | Trade time (unix timestamp in seconds) |

---

### 5. Get Current Price

Retrieve the current market price for a trading symbol.

**Endpoint**: `GET /api/custom/trading/price`

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| symbol | string | Yes | Trading symbol (e.g., "AAPL", "GOOGL") |

**Example Request**:

```
GET /api/custom/trading/price?symbol=AAPL
```

**Response** (HTTP 200 OK):

```json
{
	"ret_code": 0,
	"message": "Price retrieved successfully",
	"data": {
		"symbol": "AAPL",
		"price": 150.25
	}
}
```

**Response Fields**:
| Field | Type | Description |
|-------|------|-------------|
| symbol | string | Trading symbol |
| price | float | Current market price |

**Error Responses**:

Common error codes for this endpoint:
- `ret_code: 1400` - Competition not active
- `ret_code: 1402` - Participant not found
- `ret_code: 1403` - Market not found
- `ret_code: 1404` - Symbol not available in this market
- `ret_code: 5200` - External service error (price feed unavailable)

**Important Notes**:

- The price source is automatically determined from your competition's market configuration
- The competition must be active (ongoing status and within time range) to query prices
- Only symbols available in your competition's market can be queried
- Prices are fetched in real-time from the configured price source (FMP, DomePolymarket, or DomeKalshi)

---

## Code Examples

### Python Example

```python
import requests
import json
from typing import Dict, List, Optional

class TradingAPIClient:
    """Client for Trading Community Trading API"""

    def __init__(self, base_url: str, api_token: str):
        """
        Initialize the trading API client.

        Args:
            base_url: Base URL of the trading API (e.g., "https://lumid.market/trading")
            api_token: Your API token from the simulation strategy
        """
        self.base_url = base_url.rstrip('/')
        self.headers = {
            'X-API-Token': f'Bearer {api_token}',
            'Content-Type': 'application/json'
        }

    def submit_order(self, symbol: str, direction: str, volume: int) -> Dict:
        """
        Submit a trading order.

        Args:
            symbol: Stock symbol (e.g., "AAPL")
            direction: "Buy" or "Sell"
            volume: Number of shares

        Returns:
            Order response with execution details
        """
        url = f'{self.base_url}/api/custom/trading/order'
        payload = {
            'symbol': symbol,
            'direction': direction,
            'volume': volume
        }

        response = requests.post(url, headers=self.headers, json=payload)
        response.raise_for_status()
        return response.json()

    def get_account(self) -> Dict:
        """
        Get account information.

        Returns:
            Account information including equity, cash, and performance metrics
        """
        url = f'{self.base_url}/api/custom/trading/account'
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()

    def get_positions(self) -> List[Dict]:
        """
        Get current positions.

        Returns:
            List of current positions
        """
        url = f'{self.base_url}/api/custom/trading/positions'
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        result = response.json()
        return result.get('data', [])

    def get_trades(self, competition_id: int, simulation_strategy_id: int,
                   page: int = 1, page_size: int = 20) -> Dict:
        """
        Get trade history.

        Args:
            competition_id: Competition ID
            simulation_strategy_id: Simulation strategy ID
            page: Page number (default: 1)
            page_size: Page size (default: 20)

        Returns:
            Trade history with pagination info
        """
        url = f'{self.base_url}/api/custom/trading/trades'
        params = {
            'competition_id': competition_id,
            'simulation_strategy_id': simulation_strategy_id,
            'page': page,
            'page_size': page_size
        }

        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        return response.json()

    def get_current_price(self, symbol: str) -> Dict:
        """
        Get current market price for a symbol.

        Args:
            symbol: Trading symbol (e.g., "AAPL")

        Returns:
            Price information with symbol and current price
        """
        url = f'{self.base_url}/api/custom/trading/price'
        params = {'symbol': symbol}

        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        return response.json()


# Usage Example
if __name__ == '__main__':
    # Initialize client
    client = TradingAPIClient(
        base_url='https://lumid.market/trading',
        api_token='your_api_token_here'
    )

    # Get account information
    account = client.get_account()
    print(f"Total Equity: ${account['data']['total_equity']:.2f}")
    print(f"Available Cash: ${account['data']['available_cash']:.2f}")
    print(f"Return Rate: {account['data']['return_rate']*100:.2f}%")

    # Get current positions
    positions = client.get_positions()
    print(f"\nCurrent Positions: {len(positions)}")
    for pos in positions:
        print(f"  {pos['symbol']}: {pos['position_size']} shares @ ${pos['average_price']:.2f}")
        print(f"    Market Price: ${pos['market_price']:.2f}, P&L: ${pos['unrealized_pnl']:.2f}")

    # Get current price for a symbol
    price_info = client.get_current_price('AAPL')
    if price_info['ret_code'] == 0:
        print(f"\nCurrent Price for {price_info['data']['symbol']}: ${price_info['data']['price']:.2f}")

    # Submit a buy order
    try:
        order = client.submit_order(
            symbol='AAPL',
            direction='Buy',
            volume=100
        )
        print(f"\nOrder executed:")
        print(f"  Order ID: {order['data']['order_id']}")
        print(f"  {order['data']['direction']} {order['data']['volume']} shares of {order['data']['symbol']}")
        print(f"  Price: ${order['data']['price']:.2f}, Total: ${order['data']['value']:.2f}")
    except requests.exceptions.HTTPError as e:
        print(f"Order failed: {e}")

    # Get trade history
    trades = client.get_trades(
        competition_id=123,
        simulation_strategy_id=456,
        page=1,
        page_size=10
    )
    print(f"\nTrade History (Total: {trades['total']}):")
    for trade in trades['data']:
        print(f"  {trade['direction']} {trade['volume']} {trade['symbol']} @ ${trade['price']:.2f}")
```

---

### Go Example

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// TradingAPIClient is a client for the Trading Community Trading API
type TradingAPIClient struct {
	BaseURL    string
	APIToken   string
	HTTPClient *http.Client
}

// NewTradingAPIClient creates a new trading API client
func NewTradingAPIClient(baseURL, apiToken string) *TradingAPIClient {
	return &TradingAPIClient{
		BaseURL:  baseURL,
		APIToken: apiToken,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// OrderRequest represents a trading order request
type OrderRequest struct {
	Symbol    string `json:"symbol"`
	Direction string `json:"direction"`
	Volume    int    `json:"volume"`
}

// OrderResponse represents a trading order response
type OrderResponse struct {
	RetCode int    `json:"ret_code"`
	Message string `json:"message"`
	Data    struct {
		OrderID   int64   `json:"order_id"`
		Symbol    string  `json:"symbol"`
		Direction string  `json:"direction"`
		Price     float64 `json:"price"`
		Volume    int     `json:"volume"`
		Value     float64 `json:"value"`
		TradeTime int64   `json:"trade_time"`
	} `json:"data"`
}

// AccountResponse represents account information response
type AccountResponse struct {
	RetCode int    `json:"ret_code"`
	Message string `json:"message"`
	Data    struct {
		ParticipantID int64   `json:"participant_id"`
		TotalEquity   float64 `json:"total_equity"`
		AvailableCash float64 `json:"available_cash"`
		PositionValue float64 `json:"position_value"`
		ReturnRate    float64 `json:"return_rate"`
		MaxDrawdown   float64 `json:"max_drawdown"`
		SharpeRatio   float64 `json:"sharpe_ratio"`
		TradingTimes  int64   `json:"trading_times"`
	} `json:"data"`
}

// Position represents a trading position
type Position struct {
	Symbol        string  `json:"symbol"`
	PositionSize  int     `json:"position_size"`
	AveragePrice  float64 `json:"average_price"`
	MarketPrice   float64 `json:"market_price"`
	UnrealizedPnL float64 `json:"unrealized_pnl"`
}

// PositionsResponse represents positions response
type PositionsResponse struct {
	RetCode int        `json:"ret_code"`
	Message string     `json:"message"`
	Data    []Position `json:"data"`
}

// Trade represents a trade record
type Trade struct {
	ID        int64   `json:"id"`
	Symbol    string  `json:"symbol"`
	Direction string  `json:"direction"`
	Price     float64 `json:"price"`
	Volume    int     `json:"volume"`
	Value     float64 `json:"value"`
	TradeTime int64   `json:"trade_time"`
}

// TradesResponse represents trades response
type TradesResponse struct {
	RetCode int     `json:"ret_code"`
	Message string  `json:"message"`
	Data    []Trade `json:"data"`
	Total   int64   `json:"total"`
}

// PriceResponse represents price response
type PriceResponse struct {
	RetCode int    `json:"ret_code"`
	Message string `json:"message"`
	Data    struct {
		Symbol string  `json:"symbol"`
		Price  float64 `json:"price"`
	} `json:"data"`
}

// doRequest performs an HTTP request with authentication
func (c *TradingAPIClient) doRequest(method, path string, body interface{}) (*http.Response, error) {
	var reqBody io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewReader(jsonData)
	}

	req, err := http.NewRequest(method, c.BaseURL+path, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("X-API-Token", "Bearer "+c.APIToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	return resp, nil
}

// SubmitOrder submits a trading order
func (c *TradingAPIClient) SubmitOrder(symbol, direction string, volume int) (*OrderResponse, error) {
	req := OrderRequest{
		Symbol:    symbol,
		Direction: direction,
		Volume:    volume,
	}

	resp, err := c.doRequest("POST", "/api/custom/trading/order", req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result OrderResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error: %s (code: %d)", result.Message, result.RetCode)
	}

	return &result, nil
}

// GetAccount retrieves account information
func (c *TradingAPIClient) GetAccount() (*AccountResponse, error) {
	resp, err := c.doRequest("GET", "/api/custom/trading/account", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result AccountResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error: %s (code: %d)", result.Message, result.RetCode)
	}

	return &result, nil
}

// GetPositions retrieves current positions
func (c *TradingAPIClient) GetPositions() ([]Position, error) {
	resp, err := c.doRequest("GET", "/api/custom/trading/positions", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result PositionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error: %s (code: %d)", result.Message, result.RetCode)
	}

	return result.Data, nil
}

// GetTrades retrieves trade history
func (c *TradingAPIClient) GetTrades(competitionID, simulationStrategyID int64, page, pageSize int) (*TradesResponse, error) {
	path := fmt.Sprintf("/api/custom/trading/trades?competition_id=%d&simulation_strategy_id=%d&page=%d&page_size=%d",
		competitionID, simulationStrategyID, page, pageSize)

	resp, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result TradesResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error: %s (code: %d)", result.Message, result.RetCode)
	}

	return &result, nil
}

// GetCurrentPrice retrieves current market price for a symbol
func (c *TradingAPIClient) GetCurrentPrice(symbol string) (*PriceResponse, error) {
	path := fmt.Sprintf("/api/custom/trading/price?symbol=%s", symbol)

	resp, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result PriceResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error: %s (code: %d)", result.Message, result.RetCode)
	}

	return &result, nil
}

// Example usage
func main() {
	// Initialize client
	client := NewTradingAPIClient(
		"https://lumid.market/trading",
		"your_api_token_here",
	)

	// Get account information
	account, err := client.GetAccount()
	if err != nil {
		fmt.Printf("Failed to get account: %v\n", err)
		return
	}
	fmt.Printf("Total Equity: $%.2f\n", account.Data.TotalEquity)
	fmt.Printf("Available Cash: $%.2f\n", account.Data.AvailableCash)
	fmt.Printf("Return Rate: %.2f%%\n", account.Data.ReturnRate*100)

	// Get current positions
	positions, err := client.GetPositions()
	if err != nil {
		fmt.Printf("Failed to get positions: %v\n", err)
		return
	}
	fmt.Printf("\nCurrent Positions: %d\n", len(positions))
	for _, pos := range positions {
		fmt.Printf("  %s: %d shares @ $%.2f\n", pos.Symbol, pos.PositionSize, pos.AveragePrice)
		fmt.Printf("    Market Price: $%.2f, P&L: $%.2f\n", pos.MarketPrice, pos.UnrealizedPnL)
	}

	// Get current price for a symbol
	priceInfo, err := client.GetCurrentPrice("AAPL")
	if err != nil {
		fmt.Printf("Failed to get price: %v\n", err)
	} else if priceInfo.RetCode == 0 {
		fmt.Printf("\nCurrent Price for %s: $%.2f\n", priceInfo.Data.Symbol, priceInfo.Data.Price)
	}

	// Submit a buy order
	order, err := client.SubmitOrder("AAPL", "Buy", 100)
	if err != nil {
		fmt.Printf("Failed to submit order: %v\n", err)
	} else {
		fmt.Printf("\nOrder executed:\n")
		fmt.Printf("  Order ID: %d\n", order.Data.OrderID)
		fmt.Printf("  %s %d shares of %s\n", order.Data.Direction, order.Data.Volume, order.Data.Symbol)
		fmt.Printf("  Price: $%.2f, Total: $%.2f\n", order.Data.Price, order.Data.Value)
	}

	// Get trade history
	trades, err := client.GetTrades(123, 456, 1, 10)
	if err != nil {
		fmt.Printf("Failed to get trades: %v\n", err)
		return
	}
	fmt.Printf("\nTrade History (Total: %d):\n", trades.Total)
	for _, trade := range trades.Data {
		fmt.Printf("  %s %d %s @ $%.2f\n", trade.Direction, trade.Volume, trade.Symbol, trade.Price)
	}
}
```

---

## Best Practices

### 1. Error Handling

Always check the `ret_code` field in responses (all responses return HTTP 200 OK):

- `ret_code: 0` - Success
- `ret_code: 1400` - Competition not active
- `ret_code: 1401` - Market closed
- `ret_code: 1404` - Symbol not available
- `ret_code: 1405` - Insufficient cash
- `ret_code: 1406` - Insufficient position
- `ret_code: 401` - Invalid token
- `ret_code: 403` - Strategy not in competition
- `ret_code: 429` - Rate limit exceeded
- `ret_code: 5000+` - System errors (implement retry with exponential backoff)

### 2. Rate Limiting

The Trading API implements token bucket rate limiting to ensure fair resource usage and system stability.

**Rate Limit Rules**:

- **Limit**: 100 requests per minute per API token
- **Burst**: 100 requests (maximum burst capacity)
- **Scope**: Per API token (each simulation strategy has independent rate limits)
- **Algorithm**: Token bucket (tokens refill at 100 per minute)

**Rate Limit Response** (429 Too Many Requests):

```json
{
	"ret_code": 429,
	"message": "Too many requests. Please try again later."
}
```

**Best Practices**:

- Distribute requests evenly over time rather than bursting
- Implement exponential backoff when receiving 429 responses
- Cache account and position data when possible to reduce API calls
- Monitor your request rate to stay within limits
- For high-frequency strategies, consider batching operations where possible

### 3. Order Management

- Validate symbol and volume before submitting orders
- Check available cash before buy orders
- Verify position size before sell orders
- Monitor order execution results

### 4. Performance Monitoring

- Regularly check account metrics (return rate, Sharpe ratio, drawdown)
- Track position performance
- Analyze trade history for strategy optimization

### 5. Security

- Never commit API tokens to version control
- Store tokens in environment variables or secure configuration
- Rotate tokens if compromised
- Use HTTPS in production environments

---

## Error Codes Reference

**Important**: All API responses return HTTP 200 OK. Success or failure is indicated by the `ret_code` field in the JSON response body.

- `ret_code: 0` = Success
- `ret_code: non-zero` = Error

### Response Format

**Success Response**:
```json
{
	"ret_code": 0,
	"message": "Success message",
	"data": { ... }
}
```

**Error Response**:
```json
{
	"ret_code": <error_code>,
	"message": "Error description"
}
```

### Error Code Categories

#### General Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 400 | Invalid Input | Invalid request parameters or malformed data |
| 401 | Unauthorized | Invalid or missing API token |
| 403 | Forbidden | Valid token but action not allowed |
| 404 | Not Found | Requested resource does not exist |
| 429 | Too Many Requests | Rate limit exceeded (100 requests/minute) |
| 500 | Internal Error | Server-side error occurred |
| 5000 | Database Error | Database operation failed |
| 5200 | External Service Error | External service (e.g., price feed) failed |

#### Competition/Trading Error Codes (1400-1499)

These error codes indicate business rule violations specific to trading operations:

| Code | Error | Description | Common Causes |
|------|-------|-------------|---------------|
| 1400 | Competition Not Active | The competition is not currently active for trading | Competition hasn't started yet, has ended, or is paused |
| 1401 | Market Closed | The market/exchange is currently closed | Trading outside market hours, weekends, or holidays |
| 1402 | Participant Not Found | The participant does not exist | Invalid participant ID or participant was removed |
| 1403 | Market Not Found | The market configuration does not exist | Invalid market ID or market was deleted |
| 1404 | Symbol Not Available | The requested symbol is not available in this market | Symbol not in the market's allowed symbol list |
| 1405 | Insufficient Cash | Not enough cash to execute the buy order | Order value + fees exceeds available cash |
| 1406 | Insufficient Position | Not enough shares to execute the sell order | Attempting to sell more shares than currently held |

### Error Response Examples

#### Example 1: Competition Not Active (1400)

**Request**:
```bash
POST /api/custom/trading/order
{
	"symbol": "AAPL",
	"direction": "Buy",
	"volume": 100
}
```

**Response** (HTTP 200 OK):
```json
{
	"ret_code": 1400,
	"message": "Competition is not active"
}
```

**How to Handle**: Check competition status and trading hours before submitting orders.

#### Example 2: Insufficient Cash (1405)

**Request**:
```bash
POST /api/custom/trading/order
{
	"symbol": "AAPL",
	"direction": "Buy",
	"volume": 1000
}
```

**Response** (HTTP 200 OK):
```json
{
	"ret_code": 1405,
	"message": "Insufficient cash"
}
```

**How to Handle**: Check available cash via `/api/custom/trading/account` before submitting large orders.

#### Example 3: Market Closed (1401)

**Request**:
```bash
POST /api/custom/trading/order
{
	"symbol": "AAPL",
	"direction": "Buy",
	"volume": 100
}
```

**Response** (HTTP 200 OK):
```json
{
	"ret_code": 1401,
	"message": "Market is closed"
}
```

**How to Handle**: Only submit orders during market hours. Check exchange trading hours for your target market.

#### Example 4: Symbol Not Available (1404)

**Request**:
```bash
POST /api/custom/trading/order
{
	"symbol": "INVALID",
	"direction": "Buy",
	"volume": 100
}
```

**Response** (HTTP 200 OK):
```json
{
	"ret_code": 1404,
	"message": "Symbol not available in this market"
}
```

**How to Handle**: Verify the symbol is in the competition's allowed symbol list before trading.

#### Example 5: Insufficient Position (1406)

**Request**:
```bash
POST /api/custom/trading/order
{
	"symbol": "AAPL",
	"direction": "Sell",
	"volume": 1000
}
```

**Response** (HTTP 200 OK):
```json
{
	"ret_code": 1406,
	"message": "Insufficient position"
}
```

**How to Handle**: Check current positions via `/api/custom/trading/positions` before selling.

### Error Handling Best Practices

1. **Always Check ret_code**: Check the `ret_code` field in every response (0 = success, non-zero = error)
2. **Handle Specific Errors**: Implement specific handling for each error code
3. **Validate Before Submitting**: Check account balance and positions before submitting orders
4. **Implement Retry Logic**: For 5000+ errors, implement exponential backoff retry
5. **Handle Rate Limits**: Implement backoff when receiving error code 429
6. **Log Errors**: Log all errors with context for debugging and monitoring

---

## Support

For API support or questions:
- Check the error code reference above
- Review the code examples for proper implementation
- Contact the platform support team for assistance
