type DeploymentEnvironment = 'dev' | 'staging' | 'production';
type WeChatEnvironmentVersion = 'develop' | 'trial' | 'release';

const deploymentEnvironmentByWeChatVersion = {
  develop: 'dev',
  trial: 'staging',
  release: 'production',
} as const satisfies Record<WeChatEnvironmentVersion, DeploymentEnvironment>;

const apiBaseUrlByEnvironment: Record<DeploymentEnvironment, string> = {
  dev: 'http://127.0.0.1:3000',
  staging: 'https://staging-api.example.invalid',
  production: 'https://api.example.invalid',
};

export function getApiBaseUrl(): string {
  const envVersion = wx.getAccountInfoSync().miniProgram.envVersion;
  const environment = deploymentEnvironmentByWeChatVersion[envVersion];
  return apiBaseUrlByEnvironment[environment];
}
