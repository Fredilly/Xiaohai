export type ModulePreview = {
  key: string;
  label: string;
  description: string;
  status: '可查看' | '前端预览';
  requiredPermission?: string;
};

export const adminModules: ModulePreview[] = [
  { key: 'dashboard', label: '工作台', description: '总部运营概览与待办入口', status: '可查看' },
  {
    key: 'stores',
    label: '组织 / 门店',
    description: '门店网络与授权范围',
    status: '可查看',
    requiredPermission: 'stores.read',
  },
  { key: 'catalog', label: '图书 / 商品', description: '商品与 SKU 管理', status: '可查看' },
  {
    key: 'inventory',
    label: '库存 / 进销存',
    description: '库存、预警、流水与采购',
    status: '可查看',
    requiredPermission: 'inventory.read',
  },
  {
    key: 'orders',
    label: '订单',
    description: '订单列表与详情',
    status: '可查看',
    requiredPermission: 'orders.read',
  },
  {
    key: 'users',
    label: '用户',
    description: '用户记录与订单汇总',
    status: '可查看',
    requiredPermission: 'users.read',
  },
  {
    key: 'content',
    label: '动画 / 内容',
    description: '动画系列、分集与媒体管理',
    status: '可查看',
  },
  { key: 'ai', label: 'AI', description: 'AI 作业与审核监控', status: '可查看' },
  {
    key: 'rental',
    label: '租借',
    description: '预约、借出、归还与逾期记录',
    status: '可查看',
    requiredPermission: 'rental.read',
  },
  {
    key: 'fulfillment',
    label: '自提 / 配送',
    description: '自提与配送履约状态',
    status: '可查看',
    requiredPermission: 'fulfillment.read',
  },
  {
    key: 'franchise',
    label: '加盟',
    description: '加盟线索、跟进与审核',
    status: '可查看',
  },
  {
    key: 'payments',
    label: '支付 / 退款',
    description: '支付、退款与对账',
    status: '可查看',
    requiredPermission: 'payments.read',
  },
  {
    key: 'commission',
    label: '佣金 / 提现',
    description: '佣金规则、结算与提现审核',
    status: '可查看',
  },
  {
    key: 'finance',
    label: '财务控制',
    description: '财务流水、对账与导出',
    status: '可查看',
    requiredPermission: 'finance.read',
  },
  { key: 'cms', label: 'CMS / 运营', description: '首页内容与运营位管理', status: '可查看' },
  {
    key: 'staff',
    label: 'Staff / 权限',
    description: '员工、角色、权限与授权范围',
    status: '可查看',
    requiredPermission: 'staff.read',
  },
  {
    key: 'system',
    label: '系统 / 审计',
    description: '系统状态与操作审计',
    status: '可查看',
  },
];
