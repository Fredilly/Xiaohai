import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { DeliveryZoneInput, FulfillmentView } from '@xiaohai/contracts/fulfillment';
import {
  completeDelivery,
  createDeliveryZone,
  dispatchDelivery,
  loadDeliveryZones,
  loadFulfillment,
  markPickupReady,
  verifyPickup,
} from './fulfillment-api';

type StaffFulfillment = Awaited<ReturnType<typeof loadFulfillment>>['items'][number];

export function FulfillmentPanel({ token, storeId }: { token: string; storeId: string }) {
  const [items, setItems] = useState<StaffFulfillment[]>([]);
  const [zones, setZones] = useState<Awaited<ReturnType<typeof loadDeliveryZones>>['items']>([]);
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('正在加载…');
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [fulfillment, deliveryZones] = await Promise.all([
        loadFulfillment(token, storeId),
        loadDeliveryZones(token, storeId),
      ]);
      setItems(fulfillment.items);
      setZones(deliveryZones.items);
      setStatus(fulfillment.items.length ? '当前门店履约记录已加载' : '当前门店暂无待履约订单');
    } catch (error) {
      setStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    }
  }, [storeId, token]);

  useEffect(() => {
    setPickupCodes({});
    void refresh();
  }, [refresh]);

  const run = async (orderId: string, action: () => Promise<FulfillmentView>) => {
    setBusy(orderId);
    try {
      await action();
      setStatus('操作成功');
      setPickupCodes((current) => ({ ...current, [orderId]: '' }));
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? `操作失败：${error.message}` : '操作失败');
    } finally {
      setBusy('');
    }
  };

  async function createZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const getText = (field: string) => {
      const value = form.get(field);
      return typeof value === 'string' ? value.trim() : '';
    };
    const name = getText('name');
    const region = getText('region');
    const city = getText('city');
    const districtValue = getText('district');
    const feeMinor = Number(form.get('feeMinor'));
    if (!name || !region || !city || !Number.isInteger(feeMinor) || feeMinor < 0) {
      setStatus('配送区域信息不完整或配送费不是非负整数（分）');
      return;
    }
    const input: Omit<DeliveryZoneInput, 'providerKey'> = {
      storeId,
      name,
      region,
      city,
      district: districtValue || null,
      feeMinor,
      active: true,
    };
    try {
      await createDeliveryZone(token, input);
      formElement.reset();
      setStatus('配送区域已创建');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? `创建失败：${error.message}` : '创建失败');
    }
  }

  return (
    <section className="panel">
      <span className="tag">M16 Pickup & Delivery</span>
      <h2>订单履约</h2>
      <p>
        当前门店由 M19 工作台统一选择。自提码只由顾客端显示；配送费来自当前门店配送区域配置，MANUAL adapter 代表人工同城配送。
      </p>

      <div className="inventory-table">
        <div className="inventory-row heading">
          <span>订单</span>
          <span>方式 / 状态</span>
          <span>操作</span>
        </div>
        {items.map((item) => (
          <div className="inventory-row" key={item.orderId}>
            <span>
              <strong>{item.orderNumber}</strong>
              <small>{item.store.name}</small>
              <small>¥{(item.totalMinor / 100).toFixed(2)}</small>
            </span>
            <span>
              {item.method === 'PICKUP' ? '到店自提' : '同城配送'}
              <small>{item.orderStatus}</small>
            </span>
            <span className="inline-actions">
              {item.method === 'PICKUP' && item.orderStatus === 'PAID' && (
                <button
                  disabled={busy === item.orderId}
                  onClick={() => void run(item.orderId, () => markPickupReady(token, item.orderId))}
                >
                  标记可取
                </button>
              )}
              {item.method === 'PICKUP' && item.orderStatus === 'PICKUP_READY' && (
                <>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6 位取货码"
                    value={pickupCodes[item.orderId] ?? ''}
                    onChange={(event) =>
                      setPickupCodes((current) => ({
                        ...current,
                        [item.orderId]: event.target.value.replace(/\D/g, '').slice(0, 6),
                      }))
                    }
                  />
                  <button
                    disabled={
                      busy === item.orderId || !/^\d{6}$/.test(pickupCodes[item.orderId] ?? '')
                    }
                    onClick={() =>
                      void run(item.orderId, () =>
                        verifyPickup(token, item.orderId, pickupCodes[item.orderId] ?? ''),
                      )
                    }
                  >
                    核销
                  </button>
                </>
              )}
              {item.method === 'DELIVERY' &&
                item.orderStatus === 'PAID' &&
                item.delivery?.status === 'PENDING' && (
                  <button
                    disabled={busy === item.orderId}
                    onClick={() =>
                      void run(item.orderId, () => dispatchDelivery(token, item.orderId))
                    }
                  >
                    确认出库配送
                  </button>
                )}
              {item.method === 'DELIVERY' &&
                item.orderStatus === 'DELIVERING' &&
                item.delivery?.status === 'DISPATCHED' && (
                  <button
                    disabled={busy === item.orderId}
                    onClick={() =>
                      void run(item.orderId, () => completeDelivery(token, item.orderId))
                    }
                  >
                    确认送达
                  </button>
                )}
            </span>
          </div>
        ))}
      </div>

      <h3>配送区域与费用</h3>
      <form className="zone-form" onSubmit={(event) => void createZone(event)}>
        <input name="name" placeholder="区域名称，例如 武侯同城" required />
        <input name="region" placeholder="省/区域，例如 四川省" required />
        <input name="city" placeholder="城市，例如 成都市" required />
        <input name="district" placeholder="区县，可留空作为城市兜底" />
        <input name="feeMinor" type="number" min="0" step="1" placeholder="配送费（分）" required />
        <button type="submit">新增区域</button>
      </form>
      <div className="zone-list">
        {zones.map((zone) => (
          <div className="zone-row" key={zone.id}>
            <strong>{zone.name}</strong>
            <span>
              {zone.region} {zone.city} {zone.district ?? '全市兜底'}
            </span>
            <span>
              ¥{(zone.feeMinor / 100).toFixed(2)} · {zone.providerKey}
            </span>
          </div>
        ))}
      </div>
      <p role="status">{status}</p>
    </section>
  );
}
