import apiClient from './client';

// campaign-spotlight page hasn't been migrated yet — define a
// placeholder so this module compiles. When the page lands, swap
// this for the canonical type and re-export.
export interface Campaign {
	id: number | string;
	[key: string]: unknown;
}

export interface CampaignsResponse {
	campaigns: Campaign[];
	count: number;
}

export async function getDashboardCampaigns(): Promise<Campaign[]> {
	try {
		const response = await apiClient.get<{ data: CampaignsResponse }>('/api/v1/dashboard/campaigns');
		return response.data.data.campaigns || [];
	} catch {
		return [];
	}
}
