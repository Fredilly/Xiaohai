import { getPublicHome, type HomeSection } from '../../services/home';
import { resolveHomeTargetUrl } from './home-navigation';
import { clearFailedHeroMedia, hasCmsHero, homeDisplaySections } from './home-display';
Page({
  data: {
    loading: true,
    error: false,
    hasCmsHero: false,
    pageTitle: '小海童话',
    sections: [] as HomeSection[],
  },
  onLoad() {
    void this.loadHome();
  },
  async loadHome() {
    this.setData({ loading: true, error: false, hasCmsHero: false });
    try {
      const home = await getPublicHome();
      const sections = homeDisplaySections(home.sections);
      this.setData({
        loading: false,
        pageTitle: home.page.title,
        hasCmsHero: hasCmsHero(sections),
        sections,
      });
    } catch {
      this.setData({ loading: false, error: true, hasCmsHero: false, sections: [] });
    }
  },
  openShop() {
    void wx.navigateTo({ url: '/pages/shop/shop' });
  },
  retry() {
    void this.loadHome();
  },
  mediaError(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const failedUrl = String(event.currentTarget.dataset.src ?? '');
    const sections = clearFailedHeroMedia(this.data.sections, index, failedUrl);
    if (sections !== this.data.sections) this.setData({ sections });
  },
  openAction(event: WechatMiniprogram.TouchEvent) {
    const target = String(event.currentTarget.dataset.target ?? '');
    if (!target) return;
    void wx.navigateTo({ url: resolveHomeTargetUrl(target) });
  },
});
