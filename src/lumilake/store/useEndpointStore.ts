import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Endpoint {
  label: string;
  url: string;
}

// Lumilake-on-lum.id endpoints. Cloud is the default — the Local proxy
// (`lum.id/lumilake-api/*` → `172.17.0.1:9000/api/*`) currently lands
// on MinIO instead of the Lumilake server (Lumilake OSS isn't deployed
// on this host; MinIO holds port 9000). Default-to-Cloud means a fresh
// /dashboard/lumilake/* load actually returns data instead of MinIO's
// XML-formatted 403. Users running a local Lumilake can still toggle
// to Local in the endpoint switcher.
const ENDPOINTS: Endpoint[] = [
  { label: 'Cloud', url: 'https://kv.run:8000/lumilake/api/v1' },
  { label: 'Local', url: '/lumilake-api/v1' },
];

interface EndpointState {
  endpoints: Endpoint[];
  activeUrl: string;
  setActiveUrl: (url: string) => void;
  getActiveEndpoint: () => Endpoint;
}

export const useEndpointStore = create<EndpointState>()(
  persist(
    (set, get) => ({
      endpoints: ENDPOINTS,
      activeUrl: ENDPOINTS[0].url,
      setActiveUrl: (url: string) => set({ activeUrl: url }),
      getActiveEndpoint: () => {
        const { endpoints, activeUrl } = get();
        return endpoints.find((e) => e.url === activeUrl) || endpoints[0];
      },
    }),
    { name: 'lumilake-endpoint' }
  )
);
