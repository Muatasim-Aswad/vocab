/** Mouse or trackpad input, where focusing a field opens no on-screen keyboard. */
export const finePointer = () => window.matchMedia?.("(pointer: fine)").matches ?? false;
