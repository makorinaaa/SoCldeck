(function (global) {
  function createComposeCompletionRuntime({
    notify,
    refresh,
    schedule = setTimeout,
    onRefreshError = () => {},
  }) {
    function complete(plan) {
      notify(plan.message);
      schedule(async () => {
        try {
          await refresh(plan.refresh);
        } catch (error) {
          onRefreshError(error);
        }
      }, plan.delayMs);
    }

    return { complete };
  }

  global.SocialDeckComposeCompletion = {
    createComposeCompletionRuntime,
  };
})(window);
