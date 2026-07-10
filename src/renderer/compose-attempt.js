(function (global) {
  function createComposeAttemptRuntime() {
    let activeSubmission = null;
    let snapshot = {
      status: 'idle',
      retainedRequest: null,
      error: null,
    };

    function submit(request, deliver) {
      if (activeSubmission) return activeSubmission;

      snapshot = {
        status: 'sending',
        retainedRequest: request,
        error: null,
      };

      const submission = (async () => {
        try {
          const value = await deliver(request);
          if (value?.status === 'unknown') {
            snapshot = {
              status: 'unknown',
              retainedRequest: request,
              error: null,
              value,
            };
          } else {
            snapshot = {
              status: 'succeeded',
              retainedRequest: null,
              error: null,
              value,
            };
          }
        } catch (error) {
          snapshot = {
            status: 'failed',
            retainedRequest: request,
            error,
          };
        }

        return snapshot;
      })();
      activeSubmission = submission;
      submission.finally(() => {
        if (activeSubmission === submission) activeSubmission = null;
      });

      return submission;
    }

    function getSnapshot() {
      return snapshot;
    }

    function reset() {
      if (activeSubmission) return snapshot;
      snapshot = {
        status: 'idle',
        retainedRequest: null,
        error: null,
      };
      return snapshot;
    }

    return { submit, getSnapshot, reset };
  }

  global.SocialDeckComposeAttempt = {
    createComposeAttemptRuntime,
  };
})(window);
