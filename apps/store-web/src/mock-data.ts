export const storeModules = [
  { key: 'dashboard', label: '工作台', description: '门店日常工作入口', status: '可查看' },
  {
    key: 'books',
    label: '图书查询',
    description: '书名、作者、ISBN / 条码查询框架',
    status: '前端预览',
  },
  {
    key: 'inventory',
    label: '库存',
    description: '库存余额、出库与调整的最小操作入口',
    status: 'M14 已接入',
  },
  {
    key: 'rental',
    label: '租借',
    description: '预约、借出、归还、逾期入口框架',
    status: 'M15 已接入',
  },
  {
    key: 'orders',
    label: '订单 / 自提 / 配送',
    description: '订单履约、自提码核销、同城配送与区域费用',
    status: 'M16 已接入',
  },
  {
    key: 'operations',
    label: '门店运营',
    description: '门店信息、活动与基础运营入口',
    status: '前端预览',
  },
] as const;
