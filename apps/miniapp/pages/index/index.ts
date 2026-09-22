import { getPublicHome, type HomeSection } from '../../services/home';
import { resolveHomeTargetUrl } from './home-navigation';
Page({
  data: { loading: true, error: false, pageTitle: '小海童话', sections: [] as HomeSection[] },
  onLoad() {
    void this.loadHome();
  },
  async loadHome() {
    this.setData({ loading: true, error: false });
    try {
      const home = await getPublicHome();
      this.setData({ loading: false, pageTitle: home.page.title, sections: home.sections });
    } catch {
      this.setData({ loading: false, error: true, sections: [] });
    }
  },
  openShop() {
    void wx.navigateTo({ url: '/pages/shop/shop' });
  },
  retry() {
    void this.loadHome();
  },
  openAction(event: WechatMiniprogram.TouchEvent) {
    const target = String(event.currentTarget.dataset.target ?? '');
    if (!target) return;
    void wx.navigateTo({ url: resolveHomeTargetUrl(target) });
  },
});
