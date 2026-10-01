type DownloadTextOptions = Readonly<{
  filename: string;
  text: string;
}>;

export const downloadText = ({ filename, text }: DownloadTextOptions): void => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;

  try {
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.requestAnimationFrame(() => {
      URL.revokeObjectURL(objectUrl);
    });
  }
};
