export interface DeliveryDispatchInput {
  idempotencyKey: string;
  deliveryId: string;
  orderId: string;
  storeId: string;
  address: Record<string, unknown>;
}

export interface DeliveryDispatchResult {
  providerOrderId: string | null;
}

export interface DeliveryProvider {
  readonly key: string;
  dispatch(input: DeliveryDispatchInput): Promise<DeliveryDispatchResult>;
}

export class ManualDeliveryProvider implements DeliveryProvider {
  readonly key = 'MANUAL';

  dispatch(input: DeliveryDispatchInput): Promise<DeliveryDispatchResult> {
    void input;
    return Promise.resolve({ providerOrderId: null });
  }
}

export function loadDeliveryProvider(providerKey: string): DeliveryProvider {
  if (providerKey === 'MANUAL') return new ManualDeliveryProvider();
  throw new Error(`Unsupported delivery provider: ${providerKey}`);
}
