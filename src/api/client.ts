export class SaleorCloudClient {
  private baseUrl = 'https://cloud.saleor.io/api';
  private token: string;

  constructor(token?: string) {
    this.token = token || process.env.SALEOR_CLOUD_TOKEN || '';
    if (!this.token) {
      throw new Error('SALEOR_CLOUD_TOKEN environment variable is required');
    }
  }

  async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getStores() {
    return this.request<{ stores: Store[] }>('/stores');
  }

  async createStore(name: string, region: string = 'us-east-1') {
    return this.request<{ store: Store }>('/stores', {
      method: 'POST',
      body: JSON.stringify({ name, region }),
    });
  }

  async getEnvironments(storeId: string) {
    return this.request<{ environments: Environment[] }>(`/stores/${storeId}/environments`);
  }

  async createEnvironment(storeId: string, name: string) {
    return this.request<{ environment: Environment }>(`/stores/${storeId}/environments`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async registerApp(environmentId: string, appType: string, name: string) {
    return this.request<{ app: App }>(`/environments/${environmentId}/apps`, {
      method: 'POST',
      body: JSON.stringify({ type: appType, name }),
    });
  }
}

export interface Store {
  id: string;
  name: string;
  region: string;
  created_at: string;
}

export interface Environment {
  id: string;
  name: string;
  store_id: string;
  created_at: string;
}

export interface App {
  id: string;
  name: string;
  type: string;
  environment_id: string;
}
