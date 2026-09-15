export type FeatureCard = { key: string; title: string; subtitle: string; badge?: string };
export type DemoStore = { name: string; city: string; services: string; note: string };

export const globalFeatures: FeatureCard[] = [
  { key: 'stores', title: '全球门店 / 地图找店', subtitle: '地图能力待正式门店 API 与地图适配器' },
  { key: 'book-search', title: '图书查询', subtitle: '书名、作者、出版社、ISBN / 条码' },
  { key: 'inventory', title: '门店库存', subtitle: '当前仅展示前端状态，不代表真实库存' },
  { key: 'rental', title: '图书租借', subtitle: '预约、取书、借阅、归还流程骨架' },
  { key: 'fulfillment', title: '自提 / 同城配送', subtitle: '履约入口骨架，未接真实配送' },
  { key: 'franchise', title: '加盟胖竹', subtitle: '加盟介绍、条件与申请流程骨架' },
];

export const meFeatures: FeatureCard[] = [
  { key: 'orders', title: '我的订单', subtitle: '待付款 / 履约 / 完成等状态 UI' },
  { key: 'purchased', title: '我的动画', subtitle: '已购与继续观看入口' },
  { key: 'works', title: '我的 AI 作品', subtitle: '故事、绘本、动画作品入口' },
  { key: 'my-rental', title: '我的租借', subtitle: '借阅与归还状态入口' },
  { key: 'commission', title: '我的佣金', subtitle: '仅前端说明，未接结算系统' },
  { key: 'member', title: '会员', subtitle: '会员权益占位' },
  { key: 'address', title: '地址', subtitle: '地址管理前端入口' },
  { key: 'settings', title: '设置', subtitle: '账户与基础设置入口' },
];

export const demoStores: DemoStore[] = [
  {
    name: '胖竹书店 · 示例门店 A',
    city: '成都',
    services: '阅读 · 自习 · 活动',
    note: 'Frontend demo，不代表真实门店/库存',
  },
  {
    name: '胖竹书店 · 示例门店 B',
    city: '示例城市',
    services: '图书 · 租借 · 自提',
    note: 'Frontend demo，不代表真实营业信息',
  },
];

export const featureCopy: Record<string, { title: string; intro: string; sections: string[] }> = {
  shop: { title: '小海商城', intro: '图书优先的商城前端预览。当前没有正式商品、库存、订单或支付 API。', sections: ['图书列表与筛选', '商品详情', '购物车', '订单列表 / 订单详情'] },
  animation: { title: '小海童话动画', intro: '动画列表、详情、免费 / 试看 / 付费状态的前端骨架。', sections: ['动画列表', '动画详情', '试看状态', '我的已购'] },
  ai: { title: '小海AI——所享即所想', intro: '创作流程仅展示交互结构，不调用 AI 模型。', sections: ['故事创作', '绘本创作', '动画创作', '作品状态'] },
  stores: { title: '全球门店', intro: '门店与地图前端预览；真实门店、附近定位和地图服务尚未接入。', sections: ['门店列表', '门店详情', '地图找店', '服务项目'] },
  'book-search': { title: '图书查询', intro: '搜索交互骨架；结果为明确的 frontend demo data。', sections: ['书名 / 作者搜索', 'ISBN / 条码', '门店可售状态', '门店可租状态'] },
  inventory: { title: '门店库存', intro: '仅展示未来库存查询界面，不显示或修改真实库存。', sections: ['门店筛选', '可售状态', '可租状态', '履约入口'] },
  rental: { title: '图书租借', intro: '租借流程前端骨架，不创建真实预约或借阅记录。', sections: ['选择图书', '选择门店', '预约状态', '归还说明'] },
  fulfillment: { title: '自提 / 同城配送', intro: '履约方式前端说明，未接配送商或正式订单。', sections: ['到店自提', '同城配送', '服务范围', '状态说明'] },
  franchise: { title: '加盟胖竹', intro: '加盟介绍与申请流程骨架，提交能力尚未接入。', sections: ['品牌介绍', '加盟条件', '申请流程', '联系与跟进'] },
  share: { title: '分享与活动', intro: '分享与佣金归因尚未实现，仅提供入口与规则待定提示。', sections: ['分享入口', '活动内容', '归因说明', '佣金规则待确认'] },
  orders: { title: '我的订单', intro: '订单状态 UI 骨架，不代表真实交易。', sections: ['全部订单', '待付款', '履约中', '退款 / 完成'] },
  purchased: { title: '我的动画', intro: '已购动画前端空状态；正式权益系统尚未实现。', sections: ['已购内容', '继续观看', '试看记录', '空状态'] },
  works: { title: '我的 AI 作品', intro: '作品管理前端骨架，不调用模型、不生成真实作品。', sections: ['故事', '绘本', '动画', '任务状态'] },
  'my-rental': { title: '我的租借', intro: '租借记录前端空状态。', sections: ['预约中', '借阅中', '待归还', '历史记录'] },
  commission: { title: '我的佣金', intro: '佣金比例和结算规则仍待确认；这里不展示真实到账。', sections: ['概览', '记录', '待结算', '规则说明'] },
  member: { title: '会员', intro: '会员能力尚未进入正式业务实现。', sections: ['会员状态', '权益', '活动', '规则'] },
  address: { title: '地址', intro: '地址管理前端骨架，暂不写入正式业务数据。', sections: ['地址列表', '新增地址', '编辑', '默认地址'] },
  settings: { title: '设置', intro: '基础设置入口。', sections: ['账户', '隐私', '帮助', '关于小海童话'] },
};
