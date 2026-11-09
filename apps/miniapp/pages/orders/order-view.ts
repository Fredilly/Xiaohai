export type OrderView = 'all' | 'unpaid' | 'shipping' | 'receiving' | 'review' | 'after-sales';

type OrderViewDefinition = {
  title: string;
  statuses: readonly string[] | null;
  note: string;
};

// Match only states the existing commerce contract can actually distinguish.
// In particular, PAID also includes pickup orders, and COMPLETED does not
// record whether a customer has submitted a review.
export const orderViewDefinitions: Record<OrderView, OrderViewDefinition> = {
  all: { title: '我的订单', statuses: [], note: '' },
  unpaid: { title: '待付款', statuses: ['UNPAID'], note: '' },
  shipping: {
    title: '待发货',
    statuses: null,
    note: '当前订单数据无法区分待发货与待自提，暂不能准确筛选。',
  },
  receiving: {
    title: '待收货',
    statuses: ['DELIVERING'],
    note: '当前仅显示配送中的订单；待自提订单请在「查看全部」中查看。',
  },
  review: {
    title: '待评价',
    statuses: null,
    note: '当前尚未记录评价状态，无法准确判断哪些订单待评价。',
  },
  'after-sales': {
    title: '退款/售后',
    statuses: ['REFUNDING', 'REFUNDED'],
    note: '当前仅显示退款中、已退款订单；其他售后类型尚未接入。',
  },
};

export function parseOrderView(value?: string): OrderView {
  switch (value) {
    case 'unpaid':
    case 'shipping':
    case 'receiving':
    case 'review':
    case 'after-sales':
      return value;
    default:
      return 'all';
  }
}

export function filterOrdersByView<T extends { status: string }>(
  orders: T[],
  view: OrderView,
): T[] {
  const statuses = orderViewDefinitions[view].statuses;
  if (view === 'all' || statuses === null) return view === 'all' ? orders : [];
  return orders.filter((order) => statuses.includes(order.status));
}
