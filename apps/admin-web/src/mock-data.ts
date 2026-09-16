export type ModulePreview = {
  key: string;
  label: string;
  description: string;
  status: '可查看' | '前端预览';
};
export const adminModules: ModulePreview[] = [
  { key: 'dashboard', label: 'Dashboard', description: '总部运营概览与待办入口', status: '可查看' },
  {
    key: 'stores',
    label: '组织 / 门店',
    description: '区域、加盟商、门店管理框架',
    status: '前端预览',
  },
  { key: 'catalog', label: '图书 / 商品', description: 'M5 商品与 SKU 基础管理', status: '可查看' },
  { key: 'inventory', label: '库存', description: '库存查询与进销存操作框架', status: '前端预览' },
  {
    key: 'orders',
    label: '订单',
    description: '订单后台将在后续运营里程碑扩展；M5 Consumer 订单已实现',
    status: '前端预览',
  },
  {
    key: 'content',
    label: '动画 / 内容',
    description: 'M7 Series、Episode 与媒体元数据管理',
    status: '可查看',
  },
  { key: 'ai', label: 'AI', description: 'M8 Provider-neutral 作业与审核监控', status: '可查看' },
  { key: 'rental', label: '租借', description: '预约、借出、归还与逾期框架', status: '前端预览' },
  {
    key: 'finance',
    label: '支付 / 退款',
    description: 'M6 支付、整单退款与逐笔对账；不含佣金',
    status: '可查看',
  },
  { key: 'cms', label: 'CMS / 运营', description: '首页内容与运营位管理', status: '可查看' },
  {
    key: 'staff',
    label: 'Staff / 权限',
    description: '仅展示授权上下文；管理 API 尚未实现',
    status: '前端预览',
  },
  { key: 'system', label: '系统', description: '配置、审计与系统状态入口框架', status: '前端预览' },
];
