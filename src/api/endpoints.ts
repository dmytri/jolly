export const endpoints = {
  stores: '/stores',
  store: (id: string) => `/stores/${id}`,
  environments: (storeId: string) => `/stores/${storeId}/environments`,
  environment: (storeId: string, envId: string) => `/stores/${storeId}/environments/${envId}`,
  apps: (environmentId: string) => `/environments/${environmentId}/apps`,
  registerApp: '/apps/register',
};
