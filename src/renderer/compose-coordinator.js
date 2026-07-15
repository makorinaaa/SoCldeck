(function (global) {
  function createComposeCoordinator({
    createAttemptRuntime,
    createCrossPostRuntime,
    complete,
  }) {
    const attempts = new Map();
    const crossPost = createCrossPostRuntime();
    let crossPostCompleted = false;

    function getAttempt(networkId) {
      if (!attempts.has(networkId)) {
        attempts.set(networkId, createAttemptRuntime());
      }
      return attempts.get(networkId);
    }

    function getStatus(networkId) {
      const single = getAttempt(networkId).getSnapshot();
      const crossPostSnapshot = crossPost.getSnapshot();
      return {
        single,
        crossPost: crossPostSnapshot,
        isSending: single.status === 'sending'
          || crossPostSnapshot.targets.some(target => target.status === 'sending'),
        hasUnknownSingle: single.status === 'unknown',
        hasUnknownCross: crossPostSnapshot.targets.some(target => target.status === 'unknown'),
      };
    }

    async function submitSingle({
      networkId,
      request,
      deliver,
      completionPlan,
    }) {
      const result = await getAttempt(networkId).submit(request, deliver);
      if (result.status === 'succeeded') complete(completionPlan);
      return result;
    }

    async function submitCrossPost(entries, { retryUnknown = false } = {}) {
      const result = await crossPost.submit(entries.map(entry => ({
        id: entry.id,
        request: entry.request,
        deliver: entry.deliver,
      })), { retryUnknown });
      if (result.status === 'succeeded' && !crossPostCompleted) {
        crossPostCompleted = true;
        entries.forEach(entry => complete(entry.completionPlan));
      }
      return result;
    }

    function resetCrossPost() {
      crossPost.reset();
      crossPostCompleted = false;
    }

    function reset(networkId) {
      getAttempt(networkId).reset();
      resetCrossPost();
      return getStatus(networkId);
    }

    return {
      getStatus,
      reset,
      resetCrossPost,
      submitCrossPost,
      submitSingle,
    };
  }

  global.SocialDeckComposeCoordinator = {
    createComposeCoordinator,
  };
})(window);
