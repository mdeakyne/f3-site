export type ContactFormStatus = {
  kind: 'idle' | 'working' | 'success' | 'error';
  message: string;
};

type ContactFormControllerOptions = {
  makeFormData: () => FormData;
  send: (data: FormData) => Promise<{ ok: boolean; error?: string }>;
  resetForm: () => void;
  refreshLoadedAt: () => void;
  resetWidget: () => void;
  setSubmitDisabled: (disabled: boolean) => void;
  setFormStatus: (status: ContactFormStatus) => void;
  setChallengeStatus: (status: ContactFormStatus) => void;
};

export type ContactFormController = {
  challengeReady: (token: string) => void;
  challengeExpired: () => void;
  challengeError: () => void;
  scriptFailed: () => void;
  submit: () => Promise<void>;
};

export function selectTurnstileSiteKey(
  hostname: string,
  productionKey: string,
  testKey: string,
): string {
  return hostname === 'localhost' || hostname === '127.0.0.1'
    ? testKey
    : productionKey;
}

export function createContactFormController(
  options: ContactFormControllerOptions,
): ContactFormController {
  let token = '';
  let submitting = false;

  const setReady = (ready: boolean) => {
    options.setSubmitDisabled(!ready || submitting);
  };

  options.setSubmitDisabled(true);

  return {
    challengeReady(nextToken) {
      token = nextToken.trim();
      options.setChallengeStatus({ kind: 'idle', message: '' });
      setReady(token !== '');
    },

    challengeExpired() {
      token = '';
      setReady(false);
      options.setChallengeStatus({
        kind: 'error',
        message: 'Verification expired. Please complete it again.',
      });
    },

    challengeError() {
      token = '';
      setReady(false);
      options.setChallengeStatus({
        kind: 'error',
        message: 'Verification could not complete. Please try again.',
      });
    },

    scriptFailed() {
      token = '';
      setReady(false);
      options.setChallengeStatus({
        kind: 'error',
        message: 'Verification could not load. Refresh the page and try again.',
      });
    },

    async submit() {
      if (!token || submitting) return;

      const submittedToken = token;
      submitting = true;
      setReady(false);
      options.setFormStatus({ kind: 'working', message: 'Sending …' });

      try {
        const data = options.makeFormData();
        data.set('cf-turnstile-response', submittedToken);
        const result = await options.send(data);
        if (!result.ok) {
          options.setFormStatus({
            kind: 'error',
            message: result.error || 'Submission failed. Try again.',
          });
          return;
        }

        options.resetForm();
        options.refreshLoadedAt();
        options.setFormStatus({
          kind: 'success',
          message: '✓ Got it. Big Toe will be in touch soon. Welcome aboard.',
        });
      } catch (error) {
        options.setFormStatus({
          kind: 'error',
          message: error instanceof Error && error.message
            ? error.message
            : 'Submission failed. Try again.',
        });
      } finally {
        token = '';
        submitting = false;
        options.resetWidget();
        setReady(false);
      }
    },
  };
}
