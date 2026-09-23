/**
 * Logical inventory for the legacy Xiaohai image archive from Issue #73.
 *
 * `legacyPath` is the exact, case-sensitive path inside xiaohai-old-images.zip.
 * `proposedBosObjectPath` is planning metadata only. Issue #70 will upload the
 * selected files and replace these archive references with stable HTTPS URLs.
 */
export interface LegacyImageAsset {
  legacyPath: `图片/${string}`;
  proposedBosObjectPath: `legacy/xiaohai/${string}`;
}

const asset = <TPath extends `图片/${string}`, TBosPath extends `legacy/xiaohai/${string}`>(
  legacyPath: TPath,
  proposedBosObjectPath: TBosPath,
): LegacyImageAsset & { legacyPath: TPath; proposedBosObjectPath: TBosPath } => ({
  legacyPath,
  proposedBosObjectPath,
});

export const legacyImageAssets = {
  home: {
    xiaohaiFairyTalesBanner: asset(
      '图片/1cad0ab0e0d05c866939422fcc71ba31.png',
      'legacy/xiaohai/home/1cad0ab0e0d05c866939422fcc71ba31.png',
    ),
    parentChildReadingPhoto: asset(
      '图片/3939cc01762a13ccd07eb8e462681c75.jpg',
      'legacy/xiaohai/home/3939cc01762a13ccd07eb8e462681c75.jpg',
    ),
  },
  shop: {
    legacyShoppingCartIcon: asset('图片/3-001.png', 'legacy/xiaohai/shop/3-001.png'),
    dinosaursNeedBigHandCover: asset(
      '图片/big_380ebb63a00b19c66daec2bff3637593.png',
      'legacy/xiaohai/shop/big_380ebb63a00b19c66daec2bff3637593.png',
    ),
    pewPewTigerCoverOriginal: asset(
      '图片/3c0d665b10ed592b74b776074fa97fdf.jpg',
      'legacy/xiaohai/shop/3c0d665b10ed592b74b776074fa97fdf.jpg',
    ),
    pewPewTigerCoverProduct: asset(
      '图片/big_3c0d665b10ed592b74b776074fa97fdf.jpg',
      'legacy/xiaohai/shop/big_3c0d665b10ed592b74b776074fa97fdf.jpg',
    ),
    dodosHairyDayCoverOriginal: asset(
      '图片/72a31c645c7f6aa53740011e439c8dcc.jpg',
      'legacy/xiaohai/shop/72a31c645c7f6aa53740011e439c8dcc.jpg',
    ),
    dodosHairyDayCoverProduct: asset(
      '图片/big_72a31c645c7f6aa53740011e439c8dcc.jpg',
      'legacy/xiaohai/shop/big_72a31c645c7f6aa53740011e439c8dcc.jpg',
    ),
    pandaMusicBoxCover: asset(
      '图片/881dd86d17ad6f8f698842805952fcb0.png',
      'legacy/xiaohai/shop/881dd86d17ad6f8f698842805952fcb0.png',
    ),
    pandaMusicBoxCoverDuplicate: asset(
      '图片/big_881dd86d17ad6f8f698842805952fcb0.png',
      'legacy/xiaohai/shop/big_881dd86d17ad6f8f698842805952fcb0.png',
    ),
    yunsDiaryCover: asset(
      '图片/big_922c4ce3663df0954434a6f203c708d7.png',
      'legacy/xiaohai/shop/big_922c4ce3663df0954434a6f203c708d7.png',
    ),
    illustratedBookDisplay: asset(
      '图片/c0fc805c4697f92206e128ee5553f606.png',
      'legacy/xiaohai/shop/c0fc805c4697f92206e128ee5553f606.png',
    ),
    illustratedBookDisplayDuplicate: asset(
      '图片/big_c0fc805c4697f92206e128ee5553f606.png',
      'legacy/xiaohai/shop/big_c0fc805c4697f92206e128ee5553f606.png',
    ),
    calculatorIcon: asset(
      '图片/98f4458c92353ef6f325e315c145ce33.png',
      'legacy/xiaohai/shop/98f4458c92353ef6f325e315c145ce33.png',
    ),
    shoppingCartIcon: asset(
      '图片/c16393ec987843cdab0b8d2c248e30ba.png',
      'legacy/xiaohai/shop/c16393ec987843cdab0b8d2c248e30ba.png',
    ),
    couponClaimBanner: asset('图片/co-bag.png', 'legacy/xiaohai/shop/co-bag.png'),
  },
  stories: {
    childrensBookCopyrightPromotion: asset(
      '图片/218072eece4ccaf07aba0f33e97808dc.jpg',
      'legacy/xiaohai/stories/218072eece4ccaf07aba0f33e97808dc.jpg',
    ),
    parentChildPictureBookPlayground: asset(
      '图片/2e579b3810f38112a5f904f4b3f8ac5f.png.jpeg',
      'legacy/xiaohai/stories/2e579b3810f38112a5f904f4b3f8ac5f.png.jpeg',
    ),
    englishCreativeCourseBlue: asset(
      '图片/381e82c78149335860b376ed0170ebbd.png',
      'legacy/xiaohai/stories/381e82c78149335860b376ed0170ebbd.png',
    ),
    outdoorCreativeClassroomPromotion: asset(
      '图片/499b54154ad0c837aed5b75c4f718c5e.png.jpeg',
      'legacy/xiaohai/stories/499b54154ad0c837aed5b75c4f718c5e.png.jpeg',
    ),
    independentReadingPromotion: asset(
      '图片/594fd60fb438ee6ed9d124daedd90e45.jpg',
      'legacy/xiaohai/stories/594fd60fb438ee6ed9d124daedd90e45.jpg',
    ),
    audioReadingIcon: asset(
      '图片/b518e5bb3b3d5c2aa0cf91f0aacadd8b.png',
      'legacy/xiaohai/stories/b518e5bb3b3d5c2aa0cf91f0aacadd8b.png',
    ),
    englishCreativeCoursePurple: asset(
      '图片/f1cf595e184c8ef767cef6caeb352e9b.png',
      'legacy/xiaohai/stories/f1cf595e184c8ef767cef6caeb352e9b.png',
    ),
  },
  ai: {
    readingAssistantIcon: asset(
      '图片/0c1a64d52fc9b89531b0553dbea057c4.png',
      'legacy/xiaohai/ai/0c1a64d52fc9b89531b0553dbea057c4.png',
    ),
    electronicAuthorPlanPromotion: asset(
      '图片/3e91ab189e5a4bec668ac47be0cb26fd.jpg',
      'legacy/xiaohai/ai/3e91ab189e5a4bec668ac47be0cb26fd.jpg',
    ),
    creationChecklistIcon: asset(
      '图片/3ff22ea02e4c341b3600591c9fe2fecf.png',
      'legacy/xiaohai/ai/3ff22ea02e4c341b3600591c9fe2fecf.png',
    ),
    authorCreationCampPromotion: asset(
      '图片/673f4b15ad3e9db39c3f49d42239c093.png',
      'legacy/xiaohai/ai/673f4b15ad3e9db39c3f49d42239c093.png',
    ),
    authorCreationCampCityPromotion: asset(
      '图片/97dee94b2020215de03f132dfbca6edc.png',
      'legacy/xiaohai/ai/97dee94b2020215de03f132dfbca6edc.png',
    ),
    presentationChartIcon: asset(
      '图片/d3539512e56c42699ad4df46becf9c31.png',
      'legacy/xiaohai/ai/d3539512e56c42699ad4df46becf9c31.png',
    ),
  },
  pangzhu: {
    storeHomeIcon: asset(
      '图片/c7cf28cfe1e9c04f0cb7400ccdcd8e78.png',
      'legacy/xiaohai/pangzhu/c7cf28cfe1e9c04f0cb7400ccdcd8e78.png',
    ),
  },
  me: {
    legacyUserProfileIcon: asset('图片/4-001.png', 'legacy/xiaohai/me/4-001.png'),
    vipBadgeIcon: asset(
      '图片/e8d47e512f07f768d7205e0141d8907c.png',
      'legacy/xiaohai/me/e8d47e512f07f768d7205e0141d8907c.png',
    ),
  },
  shared: {
    legacyHomeIcon: asset('图片/1-002.png', 'legacy/xiaohai/shared/1-002.png'),
    legacyGridIcon: asset('图片/2-001.png', 'legacy/xiaohai/shared/2-001.png'),
    xiaohaiFairyTalesLogo: asset(
      '图片/51d47929bfa65594a2efec9fcc02b012.png',
      'legacy/xiaohai/shared/51d47929bfa65594a2efec9fcc02b012.png',
    ),
    xiaohaiWordmark: asset(
      '图片/6f0d0e6d1055f805140af0049c85631a.png',
      'legacy/xiaohai/shared/6f0d0e6d1055f805140af0049c85631a.png',
    ),
    rightChevronIcon: asset('图片/right-icon.png', 'legacy/xiaohai/shared/right-icon.png'),
  },
} as const;

export type LegacyImageAssetGroup = keyof typeof legacyImageAssets;
