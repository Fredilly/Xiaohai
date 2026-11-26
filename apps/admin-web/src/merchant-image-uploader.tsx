import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { MerchantProductGallery } from '@xiaohai/contracts/commerce';
import {
  getHqProductGallery,
  updateHqProductGallery,
  uploadHqDraftProductImage,
} from './catalog-api';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const allowed = ['image/jpeg', 'image/png', 'image/webp'];

export function previewableHqGalleryImage(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.port &&
      url.hostname.includes('.') &&
      !['.invalid', '.local', '.internal', '.localhost'].some((suffix) =>
        url.hostname.endsWith(suffix),
      )
    );
  } catch {
    return false;
  }
}

type GalleryImages = MerchantProductGallery['images'];

export function moveHqGalleryImage(images: GalleryImages, index: number, offset: number) {
  const target = index + offset;
  if (index < 0 || index >= images.length || target < 0 || target >= images.length) return images;
  const next = [...images];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function removeHqGalleryImage(
  images: GalleryImages,
  id: string,
  coverImageId: string | null,
) {
  if (!images.some((image) => image.id === id)) return { images, coverImageId };
  const next = images.filter((image) => image.id !== id);
  return {
    images: next,
    coverImageId: coverImageId === id ? (next[0]?.id ?? null) : coverImageId,
  };
}

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

export function HqProductImageUploader({
  token,
  productId,
  productVersion,
  onUploaded,
  onCancel,
}: {
  token: string;
  productId: string;
  productVersion: number;
  onUploaded: () => void;
  onCancel: () => void;
}) {
  const [version, setVersion] = useState(productVersion);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [galleryReady, setGalleryReady] = useState(false);
  const [images, setImages] = useState<MerchantProductGallery['images']>([]);
  const [coverImageId, setCoverImageId] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [writeAttempted, setWriteAttempted] = useState(false);
  const [message, setMessage] = useState('正在读取总部商品图库…');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void getHqProductGallery(token, productId)
      .then((gallery) => {
        if (!active) return;
        if (gallery.productId !== productId || gallery.productStatus !== 'DRAFT') {
          throw new Error('商品已上架或图库身份已变化，请刷新商品列表');
        }
        setVersion(gallery.productVersion);
        setImages(gallery.images);
        setCoverImageId(gallery.images.find((image) => image.url === gallery.coverUrl)?.id ?? null);
        setGalleryReady(true);
        setMessage(gallery.images.length ? '可调整主图、排序或移除图片。' : '尚未上传实拍图。');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setGalleryReady(false);
        setMessage(error instanceof Error ? error.message : '读取商品图库失败');
      });
    return () => {
      active = false;
    };
  }, [token, productId]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || uploading || saving || !galleryReady || changed) return;
    if (file.size === 0 || file.size > MAX_PHOTO_BYTES || !allowed.includes(file.type)) {
      setMessage('请选择 2 MB 以内的 JPG、PNG 或 WebP 图片。');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    setMessage('正在上传图片并保存商品图库…');
    try {
      const base64 = await readImageData(file);
      // Unknown POST outcome requires re-opening against an authoritative gallery.
      setGalleryReady(false);
      setWriteAttempted(true);
      const uploaded = await uploadHqDraftProductImage(token, productId, {
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        expectedProductVersion: version,
        base64,
      });
      setVersion(uploaded.productVersion);
      const gallery = await getHqProductGallery(token, productId);
      if (gallery.productId !== productId || gallery.productStatus !== 'DRAFT') {
        throw new Error('商品图库状态已变化，请关闭并刷新商品列表');
      }
      setVersion(gallery.productVersion);
      setImages(gallery.images);
      setCoverImageId(gallery.images.find((image) => image.url === gallery.coverUrl)?.id ?? null);
      setGalleryReady(true);
      setMessage(
        uploaded.duplicate ? '图片已存在，无需重复添加。' : '图片已保存，可继续上传或调整图库。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function move(index: number, offset: number) {
    if (!galleryReady || uploading || saving) return;
    const next = moveHqGalleryImage(images, index, offset);
    if (next === images) return;
    setImages(next);
    setChanged(true);
  }

  async function saveGallery() {
    if (!galleryReady || !changed || uploading || saving) return;
    if (images.length && !coverImageId) {
      setMessage('请选择一张主图后再保存。');
      return;
    }
    setSaving(true);
    setGalleryReady(false);
    setWriteAttempted(true);
    setMessage('正在保存商品图库…');
    try {
      const gallery = await updateHqProductGallery(token, productId, {
        expectedProductVersion: version,
        imageIds: images.map((image) => image.id),
        coverImageId,
      });
      if (gallery.productId !== productId || gallery.productStatus !== 'DRAFT') {
        throw new Error('商品图库状态已变化，请重新加载');
      }
      setVersion(gallery.productVersion);
      setChanged(false);
      onUploaded();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存图库失败，请关闭并重新打开');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="catalog-correction-form">
      <h3>上传与管理商品图片</h3>
      <p>仅对未上架草稿开放。图库关联总部与门店共用的商品，修改后须刷新查看最新版本。</p>
      <label>
        选择实拍图片
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={!galleryReady || uploading || saving || changed || images.length >= 8}
          onChange={(event) => void upload(event)}
        />
      </label>
      <ul aria-label="总部商品图库排序与主图">
        {images.map((image, index) => (
          <li key={image.id}>
            {previewableHqGalleryImage(image.url) ? (
              <img
                src={image.url}
                alt={`商品图片 ${index + 1}`}
                width="120"
                height="120"
                loading="lazy"
              />
            ) : (
              <span>图片地址不符合安全预览条件</span>
            )}
            <span>
              {index + 1} / {images.length}
              {coverImageId === image.id ? ' · 主图' : ''}
            </span>
            <div className="meiping-store-actions">
              <button
                type="button"
                disabled={!galleryReady || uploading || saving || index === 0}
                onClick={() => move(index, -1)}
              >
                上移
              </button>
              <button
                type="button"
                disabled={!galleryReady || uploading || saving || index === images.length - 1}
                onClick={() => move(index, 1)}
              >
                下移
              </button>
              <button
                type="button"
                disabled={!galleryReady || uploading || saving || coverImageId === image.id}
                onClick={() => {
                  setCoverImageId(image.id);
                  setChanged(true);
                }}
              >
                设为主图
              </button>
              <button
                type="button"
                disabled={!galleryReady || uploading || saving}
                onClick={() => {
                  const next = removeHqGalleryImage(images, image.id, coverImageId);
                  setImages(next.images);
                  setCoverImageId(next.coverImageId);
                  setChanged(true);
                }}
              >
                移除
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="dashboard-status" role="status">
        {message}
      </p>
      {changed && <small>图库顺序、主图或移除尚未保存；保存前暂停继续上传。</small>}
      <div className="meiping-store-actions">
        <button
          type="button"
          disabled={!changed || !galleryReady || uploading || saving}
          onClick={() => void saveGallery()}
        >
          {saving ? '保存中…' : '保存图库调整'}
        </button>
        <button
          type="button"
          disabled={uploading || saving}
          onClick={() => (writeAttempted ? onUploaded() : onCancel())}
        >
          关闭
        </button>
      </div>
    </section>
  );
}
