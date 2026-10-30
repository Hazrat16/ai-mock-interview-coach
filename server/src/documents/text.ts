// Text from an uploaded resume or job description, extracted on this computer (R22): PDF with pdf.js (via
// unpdf, no network), plain text as is. Scanned PDFs have no text layer; they are refused with a hint.
import { extractText, getDocumentProxy } from 'unpdf';
import { HttpError } from '../errors';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Longer documents are cut: only the first part is used (a resume or job description is far shorter). */
export const MAX_TEXT_CHARS = 30_000;

const tidy = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);

const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';

export async function documentText(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, 'The file is larger than 5 MB.');
  let text: string;
  if (isPdf(bytes)) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes), {
        useSystemFonts: false,
        disableFontFace: true,
        verbosity: 0,
      });
      text = (await extractText(pdf, { mergePages: true })).text;
    } catch (err) {
      throw new HttpError(400, `Could not read this PDF: ${(err as Error).message}`);
    }
  } else {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (text.includes('\u0000')) throw new HttpError(400, 'This file is neither a PDF nor plain text.');
  }
  const clean = tidy(text);
  if (clean.length < 50) {
    throw new HttpError(
      400,
      'Almost no text was found. If this is a scanned PDF (an image of a page), export it as text or paste the text instead.',
    );
  }
  return clean;
}
