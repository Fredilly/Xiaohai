import { describe, expect, it } from 'vitest';
import { filterOrdersByView, orderViewDefinitions, parseOrderView } from './order-view';

const sample = [
  { id: 'unpaid', status: 'UNPAID' },
  { id: 'paid', status: 'PAID' },
  { id: 'processing', status: 'PROCESSING' },
  { id: 'pickup', status: 'PICKUP_READY' },
  { id: 'delivering', status: 'DELIVERING' },
  { id: 'complete', status: 'COMPLETED' },
  { id: 'refunding', status: 'REFUNDING' },
  { id: 'refunded', status: 'REFUNDED' },
  { id: 'cancelled', status: 'CANCELLED' },
];

describe('order status shortcuts: supported semantics', () => {
  it('defaults unknown and missing views to all orders', () => {
    expect(parseOrderView()).toBe('all');
    expect(parseOrderView('not-a-status')).toBe('all');
    expect(filterOrdersByView(sample, 'all')).toEqual(sample);
  });

  it('shows only unpaid orders in the pending-payment view', () => {
    expect(filterOrdersByView(sample, 'unpaid').map((order) => order.id)).toEqual(['unpaid']);
  });

  it('shows only in-transit delivery orders in the receiving view', () => {
    expect(filterOrdersByView(sample, 'receiving').map((order) => order.id)).toEqual([
      'delivering',
    ]);
    expect(orderViewDefinitions.receiving.note).toContain('待自提');
  });

  it('limits refund/after-sales to statuses actually available in the current contract', () => {
    expect(filterOrdersByView(sample, 'after-sales').map((order) => order.id)).toEqual([
      'refunding',
      'refunded',
    ]);
    expect(orderViewDefinitions['after-sales'].note).toContain('其他售后');
  });

  it('does not pretend paid and processing are necessarily pending shipment', () => {
    expect(orderViewDefinitions.shipping.statuses).toBeNull();
    expect(filterOrdersByView(sample, 'shipping')).toEqual([]);
  });

  it('does not pretend all completed orders still await a review', () => {
    expect(orderViewDefinitions.review.statuses).toBeNull();
    expect(filterOrdersByView(sample, 'review')).toEqual([]);
  });
});
