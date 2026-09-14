interface IAppOption {
  globalData: { foundationReady: boolean };
}

App<IAppOption>({
  globalData: { foundationReady: true },
});
