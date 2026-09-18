import { submitFranchiseApplication } from '../../services/franchise';

type InputEvent = WechatMiniprogram.Input;

type FieldName =
  | 'name'
  | 'phone'
  | 'email'
  | 'country'
  | 'region'
  | 'city'
  | 'district'
  | 'background'
  | 'message';

Page({
  data: {
    submitting: false,
    submitted: false,
    applicationNumber: '',
    errorMessage: '',
    name: '',
    phone: '',
    email: '',
    country: '中国',
    region: '',
    city: '',
    district: '',
    background: '',
    message: '',
  },

  onFieldInput(event: InputEvent) {
    const field = String(event.currentTarget.dataset.field ?? '') as FieldName;
    if (!field) return;
    this.setData({ [field]: String(event.detail.value ?? '') });
  },

  async submit() {
    if (this.data.submitting) return;
    const name = this.data.name.trim();
    const phone = this.data.phone.trim();
    const country = this.data.country.trim();
    const region = this.data.region.trim();
    const city = this.data.city.trim();
    if (!name || phone.length < 6 || !country || !region || !city) {
      this.setData({ errorMessage: '请填写姓名、有效联系电话和完整意向地区。' });
      return;
    }

    this.setData({ submitting: true, errorMessage: '' });
    try {
      const result = await submitFranchiseApplication({
        name,
        phone,
        ...(this.data.email.trim() ? { email: this.data.email.trim() } : {}),
        country,
        region,
        city,
        ...(this.data.district.trim() ? { district: this.data.district.trim() } : {}),
        ...(this.data.background.trim() ? { background: this.data.background.trim() } : {}),
        ...(this.data.message.trim() ? { message: this.data.message.trim() } : {}),
      });
      this.setData({
        submitted: true,
        applicationNumber: result.applicationNumber,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      this.setData({
        errorMessage:
          code === 'VALIDATION_ERROR'
            ? '申请信息格式有误，请检查后重新提交。'
            : '申请暂时无法提交，请稍后再试。',
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
