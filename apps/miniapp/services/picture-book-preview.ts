import type { PictureBookDetail, PictureBookIllustration } from '@xiaohai/contracts/picture-book';

export type PictureBookPreviewImageState = 'READY' | 'PENDING' | 'FAILED' | 'MISSING';

export type PictureBookPreviewPage = {
  id: string;
  pageKind: 'COVER' | 'CONTENT';
  pageNumber: number;
  label: string;
  storyText: string;
  imageUrl: string | null;
  imageState: PictureBookPreviewImageState;
  revisionNumber: number | null;
  errorCode: string | null;
};

const latestFirst = (left: PictureBookIllustration, right: PictureBookIllustration) =>
  right.revisionNumber - left.revisionNumber;

export function selectPreviewIllustration(
  illustrations: PictureBookIllustration[],
): PictureBookIllustration | null {
  return [...illustrations]
    .sort(latestFirst)
    .find(
      (revision) =>
        revision.status === 'READY' &&
        revision.provider !== 'MOCK' &&
        Boolean(revision.mediaAssetId) &&
        Boolean(revision.playbackUrl),
    ) ?? null;
}

function previewState(
  illustrations: PictureBookIllustration[],
): Pick<PictureBookPreviewPage, 'imageState' | 'errorCode'> {
  if (illustrations.length === 0) return { imageState: 'MISSING', errorCode: null };

  const latest = [...illustrations].sort(latestFirst)[0]!;
  if (latest.status === 'FAILED') {
    return { imageState: 'FAILED', errorCode: latest.errorCode };
  }
  if (latest.status === 'QUEUED' || latest.status === 'RUNNING') {
    return { imageState: 'PENDING', errorCode: null };
  }
  return { imageState: 'MISSING', errorCode: null };
}

export function buildPictureBookPreview(detail: PictureBookDetail): PictureBookPreviewPage[] {
  return [...detail.pages]
    .sort((left, right) => {
      if (left.pageKind !== right.pageKind) return left.pageKind === 'COVER' ? -1 : 1;
      return left.pageNumber - right.pageNumber;
    })
    .map((page) => {
      const selected = selectPreviewIllustration(page.illustrations);
      const fallbackState = previewState(page.illustrations);
      return {
        id: page.id,
        pageKind: page.pageKind,
        pageNumber: page.pageNumber,
        label: page.pageKind === 'COVER' ? '封面' : `第 ${page.pageNumber} 页`,
        storyText: page.storyText ?? '',
        imageUrl: selected?.playbackUrl ?? null,
        imageState: selected ? 'READY' : fallbackState.imageState,
        revisionNumber: selected?.revisionNumber ?? null,
        errorCode: selected ? null : fallbackState.errorCode,
      };
    });
}
