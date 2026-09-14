interface IAppOption {
  globalData: { foundationReady: boolean; consumerUserId?: string };
}

App<IAppOption>({
  globalData: { foundationReady: true },
});
