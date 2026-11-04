type DeploymentEnvironment = 'dev' | 'staging' | 'production';
type WeChatEnvironmentVersion = 'develop' | 'trial' | 'release';

const deploymentEnvironmentByWeChatVersion = {
  develop: 'dev',
  trial: 'staging',
  release: 'production',
} as const satisfies Record<WeChatEnvironmentVersion, DeploymentEnvironment>;

const apiBaseUrlByEnvironment: Record<DeploymentEnvironment, string> = {
  dev: 'https://staging-api.pamboo.asia',
  staging: 'https://staging-api.pamboo.asia',
  production: 'https://api.example.invalid',
};

export function getApiBaseUrl(): string {
  const envVersion = wx.getAccountInfoSync().miniProgram.envVersion;
  const environment = deploymentEnvironmentByWeChatVersion[envVersion];
  if (!environment) throw new Error('Unsupported WeChat environment version');
  return apiBaseUrlByEnvironment[environment];
}
