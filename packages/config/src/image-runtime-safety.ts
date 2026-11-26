/**
 * Paid picture-book image input safety invariants.
 *
 * Reference signatures must outlive the Worker provider call timeout, plus
 * a clock/network margin, without relaxing the private BOS bucket policy.
 */
export const PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS = 900;
export const IMAGE_PROVIDER_MIN_TIMEOUT_MS = 600_000;
export const IMAGE_REFERENCE_EXPIRY_MARGIN_MS = 120_000;

export function assertImageReferenceLifetime(timeoutMs: number): void {
  const effectiveTimeoutMs = Math.max(timeoutMs, IMAGE_PROVIDER_MIN_TIMEOUT_MS);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    effectiveTimeoutMs + IMAGE_REFERENCE_EXPIRY_MARGIN_MS >
      PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS * 1000
  ) {
    throw new Error('IMAGE_REFERENCE_TTL_TIMEOUT_MISMATCH');
  }
}

/**
 * For #111, the workspace is in cn-beijing. A generic compatible endpoint
 * (or another workspace / region) must fail before a paid model request.
 * Never include the supplied URL or workspace identifier in errors.
 */
export function assertBeijingImageWorkspaceEndpoint(
  workspaceId: string | undefined,
  baseUrl: string | undefined,
): void {
  if (!workspaceId || !/^ws-[a-z0-9-]{6,80}$/.test(workspaceId) || !baseUrl) {
    throw new Error('IMAGE_BEIJING_WORKSPACE_ENDPOINT_MISMATCH');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new Error('IMAGE_BEIJING_WORKSPACE_ENDPOINT_MISMATCH');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.hostname !== workspaceId + '.cn-beijing.maas.aliyuncs.com' ||
    endpoint.pathname !== '/compatible-mode/v1' ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('IMAGE_BEIJING_WORKSPACE_ENDPOINT_MISMATCH');
  }
}

export function isQwenImageThreeModel(model: string): boolean {
  return model === 'qwen-image-3.0' || model === 'qwen-image-3.0-pro';
}
