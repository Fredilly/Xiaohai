export type StoreModule = {
  key:
    | 'dashboard'
    | 'books'
    | 'catalog'
    | 'catalog-corrections'
    | 'inventory'
    | 'rental'
    | 'orders'
    | 'operations'
    | 'manager'
    | 'meiping';
  label: string;
  description: string;
  status: string;
  requiredPermission?: string;
};

export const storeModules: StoreModule[] = [
  {
    key: 'dashboard',
    label: '工作台',
    description: '门店实时运营摘要与日常工作入口',
    status: 'M19 已接入',
  },
  {
    key: 'books',
    label: '图书查询',
    description: '书名、作者、出版社、ISBN / 条码查询当前门店库存',
    status: 'M13 已接入',
    requiredPermission: 'stores.read',
  },
  {
    key: 'catalog',
    label: '本店商品资料',
    description: '维护本店已建立库存关联的图书和商品资料',
    status: '日常商品 · 店铺账号可编辑',
    requiredPermission: 'catalog.edit',
  },
  {
    key: 'catalog-corrections',
    label: '商品纠错申请',
    description: '日常商品资料纠错与独立复核（采纳不生效）',
    status: '日常商品 · 申请与复核',
    requiredPermission: 'stores.read',
  },
  {
    key: 'inventory',
    label: '库存',
    description: '当前门店库存余额、出库与调整入口',
    status: 'M14 已接入',
    requiredPermission: 'inventory.read',
  },
  {
    key: 'rental',
    label: '租借',
    description: '当前门店预约、借出、归还与逾期处理',
    status: 'M15 已接入',
    requiredPermission: 'rental.read',
  },
  {
    key: 'orders',
    label: '订单 / 自提 / 配送',
    description: '当前门店订单履约、自提核验、配送与区域费用',
    status: 'M16 已接入',
    requiredPermission: 'fulfillment.read',
  },
  {
    key: 'operations',
    label: '门店运营',
    description: '采购收货、低库存、盘点、调拨与库存流水',
    status: 'M14 / M19 已接入',
    requiredPermission: 'inventory.read',
  },
  {
    key: 'meiping',
    label: '迁移资料审核',
    description: '门店内审核美萍历史迁移草稿、纠错建议和独立复核',
    status: '一次性历史数据迁移 · 不入库',
  },
];

export function visibleStoreModules(permissions: readonly string[]): StoreModule[] {
  return storeModules.filter((item) =>
    item.key === 'catalog-corrections'
      ? permissions.includes('stores.read') &&
        ((permissions.includes('inventory.read') && permissions.includes('inventory.stocktake')) ||
          permissions.includes('catalog.correction.review'))
      : item.key === 'catalog'
        ? permissions.includes('catalog.edit') && permissions.includes('stores.read')
        : item.key === 'meiping'
          ? (permissions.includes('inventory.receive') &&
              permissions.includes('inventory.stocktake')) ||
            permissions.includes('meiping.correction.review')
          : !item.requiredPermission || permissions.includes(item.requiredPermission),
  );
}
