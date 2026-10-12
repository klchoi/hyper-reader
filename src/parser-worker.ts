// The worker the page reads a book in (see reading.ts): the text of a book in, its chapters out.
import { extractChapters, normalizeFileContent } from './parser.ts';

onmessage = ({ data: { id, name, text } }: MessageEvent<{ id: number; name: string; text: string }>) => {
  try { postMessage({ id, chapters: extractChapters(name, normalizeFileContent(text), { name }) }); }
  catch (error) { postMessage({ id, error: String((error as Error)?.message ?? error) }); }
};
