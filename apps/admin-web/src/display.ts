const labels: Record<string, string> = {
  DRAFT: '草稿',
  ACTIVE: '启用',
  INACTIVE: '停用',
  PUBLISHED: '已发布',
  UNPAID: '待付款',
  PAID: '已支付',
  PROCESSING: '处理中',
  PICKUP_READY: '待自提',
  DELIVERING: '配送中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REFUNDING: '退款中',
  REFUNDED: '已退款',
  VERIFIED: '已核验',
  DELIVERED: '已送达',
  RESERVED: '已预约',
  BORROWED: '借阅中',
  RETURNED: '已归还',
  PENDING: '待处理',
  FAILED: '失败',
  SUCCEEDED: '已完成',
  QUEUED: '排队中',
  RUNNING: '运行中',
  PICKUP: '到店自提',
  DELIVERY: '配送',
  GLOBAL: '全部数据',
  STORE: '指定门店',
  REGION: '指定区域',
};

export function displayStatus(value: string) {
  return labels[value] ?? value;
}

export function money(minor: number) {
  return `¥${(minor / 100).toFixed(2)}`;
}
