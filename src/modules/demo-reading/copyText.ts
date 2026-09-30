const restoreSelection = (ranges: ReadonlyArray<Range>, selection: Selection | null): void => {
  if (selection === null) {
    return;
  }

  selection.removeAllRanges();

  for (const range of ranges) {
    selection.addRange(range);
  }
};

export const copyText = async (text: string): Promise<void> => {
  if (navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Use the standards-compatible selection fallback when clipboard permissions reject.
    }
  }

  const selection = document.getSelection();
  const ranges =
    selection === null
      ? []
      : Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
  const focusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');

  textarea.value = text;
  textarea.tabIndex = -1;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;';

  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('The browser did not copy the demo transcript.');
    }
  } finally {
    textarea.remove();
    focusedElement?.focus({ preventScroll: true });
    restoreSelection(ranges, selection);
  }
};
