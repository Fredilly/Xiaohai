const previewTitles: Record<string, string> = {
  member: '会员中心',
  settings: '设置',
  purchased: '我的动画',
  share: '分享与活动',
  fulfillment: '自提与配送',
};
Page({
  data: { title: '服务暂未开放', intro: '我们正在准备这项服务。' },
  onLoad(query: Record<string, string | undefined>) {
    const title = previewTitles[query.key ?? ''] || '服务暂未开放';
    this.setData({ title });
    void wx.setNavigationBarTitle({ title });
  },
});
