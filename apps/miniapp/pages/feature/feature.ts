import { demoBooks, featureCopy } from '../../services/mock';

Page({
  data: {
    title: '功能预览',
    intro: '该页面尚未接入正式业务 API。',
    sections: [] as string[],
    books: demoBooks,
    showBooks: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    const key = query.key ?? '';
    const content = featureCopy[key];
    if (content) {
      this.setData({
        title: content.title,
        intro: content.intro,
        sections: content.sections,
        showBooks: key === 'shop' || key === 'book-search',
      });
      void wx.setNavigationBarTitle({ title: content.title });
    }
  },
});
