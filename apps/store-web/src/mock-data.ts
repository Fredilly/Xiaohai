export const storeModules = [
  { key: 'dashboard', label: '工作台', description: '门店实时运营摘要与日常工作入口', status: 'M19 已接入' },
  {
    key: 'books',
    label: '图书查询',
    description: '书名、作者、出版社、ISBN / 条码查询当前门店库存',
    status: 'M13 已接入',
  },
  {
    key: 'inventory',
    label: '库存',
    description: '当前门店库存余额、出库与调整入口',
    status: 'M14 已接入',
  },
  {
    key: 'rental',
    label: '租借',
    description: '当前门店预约、借出、归还与逾期处理',
    status: 'M15 已接入',
  },
  {
    key: 'orders',
    label: '订单 / 自提 / 配送',
    description: '当前门店订单履约、自提核验、配送与区域费用',
    status: 'M16 已接入',
  },
  {
    key: 'operations',
    label: '门店运营',
    description: '采购收货、低库存、盘点、调拨与库存流水',
    status: 'M14 / M19 已接入',
  },
] as const;
