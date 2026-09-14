import { loginWithWeChat } from '../../services/auth';

Page({
  data: {
    title: '小海童话',
    subtitle: 'M2-1 Consumer Auth / 消费者认证',
    status: '尚未登录',
    isLoading: false,
  },
  async login() {
    this.setData({ isLoading: true, status: '登录中…' });
    try {
      const result = await loginWithWeChat();
      getApp<IAppOption>().globalData.consumerUserId = result.consumer.id;
      this.setData({ status: `已登录：${result.consumer.id}` });
    } catch {
      this.setData({ status: '登录失败，请检查 AppID、网络与后端配置' });
    } finally {
      this.setData({ isLoading: false });
    }
  },
});
