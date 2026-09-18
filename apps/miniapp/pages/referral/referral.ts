Page({
  onLoad(options: Record<string, string | undefined>) {
    const code = String(options.code || '');
    if (/^[A-Z0-9_-]{8,32}$/.test(code)) wx.setStorageSync('referral_code', code);
  },
  goShopping() {
    void wx.switchTab({ url: '/pages/index/index' });
  },
});
