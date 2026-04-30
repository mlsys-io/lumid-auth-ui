/**
 * Market Data API — real-time quotes.
 * All data fetched from QuantArena backend /api/v1/market/quotes (Redis-cached).
 */

import apiClient from './client';

export interface StockQuote {
	symbol: string;
	name: string;
	c: number;
	d: number;
	dp: number;
	h: number;
	l: number;
	pc: number;
	updated: number;
}

export interface MarketQuotesResponse {
	stocks: StockQuote[];
	indices: StockQuote[];
	updated: string;
	count: number;
}

export async function getMarketQuotes(): Promise<MarketQuotesResponse> {
	try {
		const response = await apiClient.get<{ data: MarketQuotesResponse }>('/api/v1/market/quotes');
		return response.data.data;
	} catch {
		return { stocks: [], indices: [], updated: '', count: 0 };
	}
}

// --- News & KOL Tweets ---

export interface NewsArticle {
	id: string;
	headline: string;
	image: string;
	source: string;
	summary: string;
	url: string;
	symbol: string;
	datetime: number;
	category?: string;
}

export interface NewsResponse {
	articles: NewsArticle[];
	count: number;
	updated: string;
}

export interface KOLTweet {
	id: string;
	username: string;
	display_name: string;
	avatar_url: string;
	text: string;
	created_at: string;
	created_at_ts: number;
	likes: number;
	retweets: number;
	replies: number;
	views: number;
	symbols: string;
}

export interface KOLTweetsResponse {
	tweets: KOLTweet[];
	count: number;
	updated: string;
}

export async function getMarketNews(params?: { symbol?: string; limit?: number }): Promise<NewsResponse> {
	try {
		const response = await apiClient.get<{ data: NewsResponse }>('/api/v1/market/news', { params });
		return response.data.data;
	} catch {
		return { articles: [], count: 0, updated: '' };
	}
}

export async function getKOLTweets(params?: { username?: string; limit?: number }): Promise<KOLTweetsResponse> {
	try {
		const response = await apiClient.get<{ data: KOLTweetsResponse }>('/api/v1/market/tweets', { params });
		return response.data.data;
	} catch {
		return { tweets: [], count: 0, updated: '' };
	}
}

export async function getQuote(symbol: string): Promise<StockQuote | null> {
	try {
		const response = await apiClient.get<{ data: StockQuote }>('/api/v1/market/quote', { params: { symbol } });
		return response.data.data;
	} catch {
		return null;
	}
}
