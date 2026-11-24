import { useRef, useState, type ChangeEvent } from 'react';
import { uploadStoreDraftProductImage } from './store-catalog-api';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const allowed = ['image/jpeg', 'image/png', 'image/webp'];

async function readImageData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string') {
        reject(new Error('读取图片失败'));
        return;
      }
      const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
      if (!match?.[1]) {
        reject(new Error('只能选择 JPG、PNG 或 WebP 图片'));
        return;
      }
      resolve(match[1]);
    };
    reader.readAsDataURL(file);
  });
}

export function StoreProductImageUploader({
  token,
  storeId,
  productId,
  productVersion,
  onUploaded,
  onCancel,
}: {
  token: string;
  storeId: string;
  productId: string;
  productVersion: number;
  onUploaded: () => void;
  onCancel: () => void;
}) {
  const [version, setVersion] = useState(productVersion);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('上传实拍图到本店未上架的商品草稿。');
  const [previewUrl, setPreviewUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || uploading) return;
    if (file.size === 0 || file.size > MAX_PHOTO_BYTES || !allowed.includes(file.type)) {
      setMessage('请选择 2 MB 以内的 JPG、PNG 或 WebP 图片。');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    setMessage('正在上传图片并保存商品图库…');
    try {
      const base64 = await readImageData(file);
      const uploaded = await uploadStoreDraftProductImage(token, storeId, productId, {
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        expectedProductVersion: version,
        base64,
      });
      setVersion(uploaded.productVersion);
      setPreviewUrl(uploaded.url);
      setMessage(uploaded.duplicate ? '图片已存在，无需重复添加。' : '图片已保存到商品图库。');
      onUploaded();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <section className="catalog-correction-form">
      <h3>上传商品图片</h3>
      <p>仅对未上架草稿开放。已在其他门店关联的共享商品暂不允许从单店更换图片。</p>
      <label>
        选择实拍图片
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
          onChange={(event) => void upload(event)}
        />
      </label>
      {previewUrl && <img src={previewUrl} alt="刚上传的商品图片" width="160" height="160" />}
      <p className="dashboard-status" role="status">
        {message}
      </p>
      <button type="button" disabled={uploading} onClick={onCancel}>
        关闭
      </button>
    </section>
  );
}
