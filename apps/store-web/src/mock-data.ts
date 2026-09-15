export const storeModules = [
  { key: 'dashboard', label: '工作台', description: '门店日常工作入口', status: '可查看' },
  { key: 'books', label: '图书查询', description: '书名、作者、ISBN / 条码查询框架', status: '前端预览' },
  { key: 'inventory', label: '库存', description: '库存查看、盘点、调拨入口框架', status: '前端预览' },
  { key: 'rental', label: '租借', description: '预约、借出、归还、逾期入口框架', status: '前端预览' },
  { key: 'orders', label: '订单 / 自提 / 配送', description: '订单履约、自提核销、同城配送框架', status: '前端预览' },
  { key: 'operations', label: '门店运营', description: '门店信息、活动与基础运营入口', status: '前端预览' },
] as const;
