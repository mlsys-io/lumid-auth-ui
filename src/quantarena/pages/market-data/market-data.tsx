import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Loading } from '../../components/ui/loading';
import { TrendingUp, Globe, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { getMarketQuotes, getMarketNews, getKOLTweets, type StockQuote, type NewsArticle, type KOLTweet } from '../../api/market-data';

const MarketData = () => {
	const [stocks, setStocks] = useState<StockQuote[]>([]);
	const [indices, setIndices] = useState<StockQuote[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [flash, setFlash] = useState<Record<string, 'up' | 'down' | ''>>({});
	const [news, setNews] = useState<NewsArticle[]>([]);
	const [tweets, setTweets] = useState<KOLTweet[]>([]);
	const [activeTab, setActiveTab] = useState<'prices' | 'news' | 'kol'>('prices');
	const prevPrices = useRef<Record<string, number>>({});

	useEffect(() => {
		fetchData();
		fetchNews();
		fetchTweets();
		const priceInterval = setInterval(fetchData, 10000);
		const newsInterval = setInterval(() => { fetchNews(); fetchTweets(); }, 60000);
		return () => { clearInterval(priceInterval); clearInterval(newsInterval); };
	}, []);

	const fetchNews = async () => {
		try {
			const data = await getMarketNews({ limit: 30 });
			if (data.articles.length > 0) setNews(data.articles);
		} catch { /* keep existing */ }
	};

	const fetchTweets = async () => {
		try {
			const data = await getKOLTweets({ limit: 30 });
			if (data.tweets.length > 0) setTweets(data.tweets);
		} catch { /* keep existing */ }
	};

	const fetchData = async () => {
		try {
			const data = await getMarketQuotes();
			const newFlash: Record<string, 'up' | 'down' | ''> = {};
			[...data.stocks, ...data.indices].forEach((q) => {
				const prev = prevPrices.current[q.symbol];
				if (prev !== undefined && q.c !== prev) {
					newFlash[q.symbol] = q.c > prev ? 'up' : 'down';
				}
				prevPrices.current[q.symbol] = q.c;
			});
			setStocks(data.stocks || []);
			setIndices(data.indices || []);
			setLoading(false);
			setError(null);
			if (Object.keys(newFlash).length > 0) {
				setFlash(newFlash);
				setTimeout(() => setFlash({}), 800);
			}
		} catch {
			if (loading) setError('Failed to load. Check backend + data service.');
			setLoading(false);
		}
	};

	if (loading) return <Loading text="Loading market data..." />;
	if (error) return (
		<div className="flex flex-col items-center justify-center py-20">
			<Globe className="w-12 h-12 text-gray-300 mb-4" />
			<p className="text-gray-500">{error}</p>
		</div>
	);

	return (
		<div className="space-y-6">
			{/* Tab navigation */}
			<div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
				{(['prices', 'news', 'kol'] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
							activeTab === tab ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
						}`}
					>
						{tab === 'prices' ? 'Prices' : tab === 'news' ? 'News' : 'KOL Insights'}
					</button>
				))}
			</div>

			{activeTab === 'prices' && <>
			{indices.length > 0 && (
				<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
					{indices.map((idx) => (
						<Card key={idx.symbol} className={`transition-all duration-500 ${flash[idx.symbol] === 'up' ? 'border-green-300 shadow-green-100 shadow-md' : flash[idx.symbol] === 'down' ? 'border-red-300 shadow-red-100 shadow-md' : ''}`}>
							<CardContent className="p-3">
								<div className="text-xs text-gray-500">{idx.name}</div>
								<div className="text-lg font-bold tabular-nums">${idx.c?.toFixed(2)}</div>
								<div className={`text-xs flex items-center gap-1 ${(idx.dp || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
									{(idx.dp || 0) >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
									{idx.d?.toFixed(2)} ({idx.dp?.toFixed(2)}%)
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base flex items-center gap-2">
						<TrendingUp className="w-4 h-4" /> Stocks (Live — 5s refresh)
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-gray-500">
									<th className="py-2 px-3 font-medium">Symbol</th>
									<th className="py-2 px-3 font-medium text-right">Price</th>
									<th className="py-2 px-3 font-medium text-right">Change</th>
									<th className="py-2 px-3 font-medium text-right">%</th>
									<th className="py-2 px-3 font-medium text-right">High</th>
									<th className="py-2 px-3 font-medium text-right">Low</th>
								</tr>
							</thead>
							<tbody>
								{stocks.map((s) => (
									<tr key={s.symbol} className={`border-b transition-all duration-500 ${flash[s.symbol] === 'up' ? 'bg-green-50' : flash[s.symbol] === 'down' ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
										<td className="py-2.5 px-3">
											<div className="font-medium">{s.symbol}</div>
											<div className="text-xs text-gray-400">{s.name}</div>
										</td>
										<td className="py-2.5 px-3 text-right font-mono tabular-nums">${s.c?.toFixed(2)}</td>
										<td className={`py-2.5 px-3 text-right ${(s.d || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>{s.d?.toFixed(2)}</td>
										<td className="py-2.5 px-3 text-right">
											<Badge variant="outline" className={`text-xs ${(s.dp || 0) >= 0 ? 'text-green-600 border-green-200' : 'text-red-500 border-red-200'}`}>
												{(s.dp || 0) >= 0 ? '\u25B2' : '\u25BC'} {Math.abs(s.dp || 0).toFixed(2)}%
											</Badge>
										</td>
										<td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">${s.h?.toFixed(2)}</td>
										<td className="py-2.5 px-3 text-right text-gray-500 tabular-nums">${s.l?.toFixed(2)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>
			</>}

			{/* News Tab */}
			{activeTab === 'news' && (
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-base flex items-center gap-2">
							<svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
							Market News (Live — 60s refresh)
						</CardTitle>
					</CardHeader>
					<CardContent>
						{news.length === 0 ? (
							<p className="text-sm text-gray-500 text-center py-8">No news available yet. News collectors update every minute.</p>
						) : (
							<div className="space-y-3">
								{news.map((article) => (
									<a
										key={article.id}
										href={article.url}
										target="_blank"
										rel="noopener noreferrer"
										className="flex gap-4 p-3 rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all group"
									>
										{article.image && (
											<img
												src={article.image}
												alt=""
												className="w-24 h-16 rounded-lg object-cover shrink-0 bg-gray-100"
												onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
											/>
										)}
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium text-gray-800 line-clamp-2 group-hover:text-indigo-700 transition-colors">
												{article.headline}
											</p>
											{article.summary && (
												<p className="text-xs text-gray-500 mt-1 line-clamp-1">{article.summary}</p>
											)}
											<div className="flex items-center gap-2 mt-1.5">
												<span className="text-[11px] text-gray-400 font-medium">{article.source}</span>
												{article.symbol && (
													<Badge variant="outline" className="text-[10px] px-1.5 py-0 text-indigo-600 border-indigo-200">
														${article.symbol}
													</Badge>
												)}
												<span className="text-[11px] text-gray-400 ml-auto">
													{article.datetime ? new Date(article.datetime * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
												</span>
											</div>
										</div>
									</a>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			)}

			{/* KOL Insights Tab */}
			{activeTab === 'kol' && (
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-base flex items-center gap-2">
							<svg className="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
							KOL Insights — Follow the Smart Money (Live — 60s refresh)
						</CardTitle>
					</CardHeader>
					<CardContent>
						{tweets.length === 0 ? (
							<p className="text-sm text-gray-500 text-center py-8">No KOL tweets available yet. Tweet collectors update every minute.</p>
						) : (
							<div className="space-y-3">
								{tweets.map((tweet) => (
									<a key={tweet.id} href={`https://x.com/${tweet.username}/status/${tweet.id}`} target="_blank" rel="noopener noreferrer" className="flex gap-3 p-3 rounded-lg border border-gray-100 hover:border-purple-200 hover:bg-purple-50/20 transition-all cursor-pointer">
										{tweet.avatar_url ? (
											<img src={tweet.avatar_url} alt="" className="w-10 h-10 rounded-full shrink-0 bg-gray-100" />
										) : (
											<div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 shrink-0 flex items-center justify-center text-white text-sm font-bold">
												{tweet.username?.[0]?.toUpperCase()}
											</div>
										)}
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<span className="text-sm font-semibold text-gray-800">{tweet.display_name || tweet.username}</span>
												<span className="text-xs text-gray-400">@{tweet.username}</span>
												<span className="text-xs text-gray-400 ml-auto">
													{tweet.created_at ? new Date(tweet.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
												</span>
											</div>
											<p className="text-sm text-gray-700 mt-1 whitespace-pre-line leading-relaxed">{tweet.text}</p>
											<div className="flex items-center gap-3 mt-2">
												{tweet.symbols && (
													<div className="flex gap-1 flex-wrap">
														{tweet.symbols.split(',').filter(Boolean).map((sym) => (
															<Badge key={sym} variant="outline" className="text-[10px] px-1.5 py-0 text-purple-600 border-purple-200">
																${sym}
															</Badge>
														))}
													</div>
												)}
												<div className="flex items-center gap-3 ml-auto text-xs text-gray-400">
													{tweet.likes > 0 && <span>♥ {tweet.likes >= 1000 ? `${(tweet.likes / 1000).toFixed(1)}K` : tweet.likes}</span>}
													{tweet.retweets > 0 && <span>↻ {tweet.retweets >= 1000 ? `${(tweet.retweets / 1000).toFixed(1)}K` : tweet.retweets}</span>}
													{tweet.views > 0 && <span>👁 {tweet.views >= 1000000 ? `${(tweet.views / 1000000).toFixed(1)}M` : tweet.views >= 1000 ? `${(tweet.views / 1000).toFixed(1)}K` : tweet.views}</span>}
												</div>
											</div>
										</div>
									</a>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	);
};

export default MarketData;
