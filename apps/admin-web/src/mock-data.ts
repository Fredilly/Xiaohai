export type ModulePreview = {
  key: string;
  label: string;
  description: string;
  status: '可查看' | '前端预览';
  requiredPermission?: string;
};

export const adminModules: ModulePreview[] = [
  { key: 'dashboard', label: 'Dashboard', description: '总部运营概览与待办入口', status: '可查看' },
  {
    key: 'stores',
    label: '组织 / 门店',
    description: 'M12 门店网络与授权范围',
    status: '可查看',
    requiredPermission: 'stores.read',
  },
  { key: 'catalog', label: '图书 / 商品', description: 'M5 商品与 SKU 基础管理', status: '可查看' },
  {
    key: 'inventory',
    label: '库存 / 进销存',
    description: 'M14 库存、预警、流水与采购上下文',
    status: '可查看',
    requiredPermission: 'inventory.read',
  },
  {
    key: 'orders',
    label: '订单',
    description: 'M20-B HQ 订单列表、详情与不可变快照支持视图',
    status: '可查看',
    requiredPermission: 'orders.read',
  },
  {
    key: 'users',
    label: '用户',
    description: 'M20-B Consumer 最小身份元数据与订单汇总支持视图',
    status: '可查看',
    requiredPermission: 'users.read',
  },
  {
    key: 'content',
    label: '动画 / 内容',
    description: 'M7 Series、Episode 与媒体元数据管理',
    status: '可查看',
  },
  { key: 'ai', label: 'AI', description: 'M8 Provider-neutral 作业与审核监控', status: '可查看' },
  {
    key: 'rental',
    label: '租借',
    description: 'M15 预约、借出、归还与逾期记录',
    status: '可查看',
    requiredPermission: 'rental.read',
  },
  {
    key: 'fulfillment',
    label: '自提 / 配送',
    description: 'M16 自提与配送履约状态',
    status: '可查看',
    requiredPermission: 'fulfillment.read',
  },
  {
    key: 'franchise',
    label: '加盟',
    description: 'M17 加盟线索、分配、跟进、审核与状态推进',
    status: '可查看',
  },
  {
    key: 'finance',
    label: '支付 / 退款',
    description: 'M6 支付、整单退款与逐笔对账',
    status: '可查看',
  },
  {
    key: 'commission',
    label: '佣金 / 提现',
    description: 'M18 规则、结算、冲正与提现审核',
    status: '可查看',
  },
  { key: 'cms', label: 'CMS / 运营', description: '首页内容与运营位管理', status: '可查看' },
  {
    key: 'staff',
    label: 'Staff / 权限',
    description: 'M20-C Staff、角色、权限与 Data Scope 管理',
    status: '可查看',
    requiredPermission: 'staff.read',
  },
  {
    key: 'system',
    label: '系统 / 审计',
    description: 'M20-D/E 将补齐审计与系统状态',
    status: '前端预览',
  },
];
