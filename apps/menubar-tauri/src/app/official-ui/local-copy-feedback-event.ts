export const LOCAL_COPY_FEEDBACK_EVENT = "barwarden:local-copy-feedback";
let nextLocalCopyFeedbackToken = 0;
const receiptByTrigger = new WeakMap<Event, LocalCopyFeedbackReceipt>();
const capturedReceipts: LocalCopyFeedbackReceipt[] = [];

export interface LocalCopyFeedbackReceipt {
  readonly button: HTMLButtonElement;
  readonly token: number;
}

export function beginLocalCopyFeedback(
  button: HTMLButtonElement,
): LocalCopyFeedbackReceipt {
  const receipt = {
    button,
    token: ++nextLocalCopyFeedbackToken,
  };
  dispatch(button, { pending: true, token: receipt.token });
  return receipt;
}

export function captureLocalCopyFeedback(
  button: HTMLButtonElement,
  trigger: Event,
): void {
  const receipt = beginLocalCopyFeedback(button);
  receiptByTrigger.set(trigger, receipt);
  capturedReceipts.push(receipt);
}

export function claimLocalCopyFeedback(
  trigger: Event,
): LocalCopyFeedbackReceipt | null {
  const receipt = receiptByTrigger.get(trigger) ?? null;
  receiptByTrigger.delete(trigger);
  if (receipt) {
    removeCapturedReceipt(receipt);
  }
  return receipt;
}

/** Claims the receipt captured immediately before the current copy handler. */
export function claimCapturedLocalCopyFeedback(): LocalCopyFeedbackReceipt | null {
  while (capturedReceipts[0] && !capturedReceipts[0].button.isConnected) {
    capturedReceipts.shift();
  }
  const receipt = capturedReceipts.shift() ?? null;
  return receipt;
}

export function completeLocalCopyFeedback(
  receipt: LocalCopyFeedbackReceipt | null,
  failed: boolean,
): void {
  if (receipt) {
    dispatch(receipt.button, { failed, token: receipt.token });
  }
}

function dispatch(
  button: HTMLButtonElement,
  detail: {
    readonly pending?: boolean;
    readonly failed?: boolean;
    readonly token: number;
  },
): void {
  button.dispatchEvent(new CustomEvent(LOCAL_COPY_FEEDBACK_EVENT, {
    bubbles: true,
    detail,
  }));
}

function removeCapturedReceipt(receipt: LocalCopyFeedbackReceipt): void {
  const index = capturedReceipts.indexOf(receipt);
  if (index >= 0) {
    capturedReceipts.splice(index, 1);
  }
}
