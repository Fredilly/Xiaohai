import { demoStores, globalFeatures } from '../../services/mock';

Page({
  data: { features: globalFeatures, stores: demoStores },
  openFeature(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? '');
    if (key) void wx.navigateTo({ url: `/pages/feature/feature?key=${encodeURIComponent(key)}` });
  },
});
