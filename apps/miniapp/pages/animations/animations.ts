import type { Animation } from '@xiaohai/contracts/animation';
import { AnimationApiError, listAnimations } from '../../services/animation';
import { consumerToken } from '../../services/consumer-session';

Page({
  readSequence: 0,
  wasHidden: false,
  loadedSession: '',
  data: { loading: true, error: '', needsLogin: false, animations: [] as Animation[] },
  onShow() {
    this.wasHidden = false;
    void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.readSequence++;
    this.loadedSession = '';
    this.setData({ animations: [], loading: false });
  },
  onUnload() {
    this.wasHidden = true;
    this.readSequence++;
    this.loadedSession = '';
  },
  async load() {
    if (this.wasHidden) return;
    const version = ++this.readSequence;
    const session = consumerToken();
    this.loadedSession = '';
    if (!session) {
      this.setData({ animations: [], loading: false, error: '', needsLogin: true });
      return;
    }
    this.setData({ animations: [], loading: true, error: '', needsLogin: false });
    try {
      const result = await listAnimations();
      if (version !== this.readSequence || this.wasHidden) return;
      const currentSession = consumerToken();
      if (currentSession !== session) {
        this.setData({ animations: [], loading: false, needsLogin: !currentSession });
        if (currentSession) void this.load();
        return;
      }
      this.loadedSession = session;
      this.setData({ animations: result.animations, loading: false });
    } catch (error) {
      if (version !== this.readSequence || this.wasHidden) return;
      const currentSession = consumerToken();
      if (currentSession !== session) {
        this.setData({ animations: [], loading: false, needsLogin: !currentSession });
        if (currentSession) void this.load();
        return;
      }
      const needsLogin = error instanceof AnimationApiError && error.status === 401;
      this.setData({
        animations: [],
        loading: false,
        needsLogin,
        error: needsLogin ? '' : '动画作品加载失败，请检查网络后重试。',
      });
    }
  },
  goToLogin() {
    void wx.switchTab({ url: '/pages/me/me' });
  },
  open(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id && !this.wasHidden && this.loadedSession && this.loadedSession === consumerToken())
      void wx.navigateTo({
        url: `/pages/animation-detail/animation-detail?id=${encodeURIComponent(id)}`,
      });
  },
});
