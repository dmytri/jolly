export class SaleorCloudClient {
  private baseUrl = 'https://cloud.saleor.io/api/v1';
  private token: string;

  constructor(token?: string) {
    this.token = token || process.env.SALEOR_CLOUD_TOKEN || '';
    if (!this.token) {
      throw new Error('SALEOR_CLOUD_TOKEN environment variable is required');
    }
  }

  async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const mergedOptions: RequestInit = {
      method: options?.method || 'GET',
      ...options,
      headers: {
        'Authorization': `Token ${this.token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    };

    const response = await fetch(`${this.baseUrl}${endpoint}`, mergedOptions);

    if (!response.ok) {
      const body = await response.text();
      const truncatedBody = body.length > 200 ? body.substring(0, 200) + '...' : body;
      throw new Error(`API error: ${response.status} ${response.statusText} - ${truncatedBody}`);
    }

    return response.json() as T;
  }

  // Organizations
  async getOrganizations() {
    return this.request<{ organizations: Organization[] }>('/organizations');
  }

  // Projects
  async getProjects(organizationSlug: string) {
    return this.request<{ projects: Project[] }>(`/organizations/${organizationSlug}/projects`);
  }

  async createProject(organizationSlug: string, name: string, region: string) {
    return this.request<{ project: Project }>(`/organizations/${organizationSlug}/projects`, {
      method: 'POST',
      body: JSON.stringify({ name, region }),
    });
  }

  // Environments
  async getEnvironments(organizationSlug: string, projectSlug: string) {
    return this.request<{ environments: Environment[] }>(
      `/organizations/${organizationSlug}/projects/${projectSlug}/environments`
    );
  }

  async createEnvironment(organizationSlug: string, projectSlug: string, name: string, region: string) {
    return this.request<{ environment: Environment; task: Task }>(
      `/organizations/${organizationSlug}/projects/${projectSlug}/environments`,
      {
        method: 'POST',
        body: JSON.stringify({ name, region }),
      }
    );
  }

  async getEnvironment(organizationSlug: string, projectSlug: string, environmentSlug: string) {
    return this.request<Environment>(
      `/organizations/${organizationSlug}/projects/${projectSlug}/environments/${environmentSlug}`
    );
  }

  // Apps
  async registerApp(environmentId: string, appType: string, name: string) {
    return this.request<{ app: App }>(`/environments/${environmentId}/apps`, {
      method: 'POST',
      body: JSON.stringify({ type: appType, name }),
    });
  }

  // Backward compatibility methods
  async getStores() {
    return this.getOrganizations();
  }

  async createStore(name: string, region: string = 'us-east-1') {
    // Create organization as "store" - requires org slug
    // For now, create in first available org
    const { organizations } = await this.getOrganizations();
    if (organizations.length === 0) {
      throw new Error('No organizations found. Create one at https://cloud.saleor.io');
    }
    return this.createProject(organizations[0].slug, name, region);
  }

  async createEnvironmentFromStore(storeId: string, name: string) {
    // storeId is used as organization slug for backward compatibility
    const { environments } = await this.getEnvironments(storeId, 'default');
    // Create sandbox environment
    return this.createEnvironment(storeId, environments.length > 0 ? environments[0].project?.slug || 'default' : 'default', name, 'default');
  }
}

export interface Organization {
  slug: string;
  name: string;
  created: string;
  company_name?: string;
  owner_email: string;
}

export interface Project {
  slug: string;
  name: string;
  region: string;
  created: string;
  billing_period?: { start: string };
  sandboxes: { count: number };
}

export interface Environment {
  key: string;
  name: string;
  domain: string;
  service: {
    version: string;
    type: string;
    region: string;
  };
  created: string;
  project: { name: string; slug: string };
}

export interface Task {
  id: string;
  status: string;
}

export interface Store {
  id: string;
  name: string;
  region: string;
  created_at: string;
}

export interface App {
  id: string;
  name: string;
  type: string;
  environment_id: string;
}
