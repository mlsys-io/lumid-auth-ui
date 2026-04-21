import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Endpoint {
  label: string;
  url: string;
}

// Lumilake-on-lum.id endpoints. Local reaches the Lumilake OSS server
// running on the lum.id host (proxied via lum.id nginx at
// /lumilake-api/* → localhost:9000/api/*); Cloud hits the production
// kv.run deployment directly.
const ENDPOINTS: Endpoint[] = [
  { label: 'Local', url: '/lumilake-api/v1' },
  { label: 'Cloud', url: 'https://kv.run:8000/lumilake/api/v1' },
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
