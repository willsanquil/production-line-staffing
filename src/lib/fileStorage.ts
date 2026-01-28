import type { AppState } from '../types';
import { exportStateToJson, importStateFromJson } from './persist';

const DEFAULT_FILENAME = 'production-line-staffing.json';

/** File System Access API: save to a real file. Returns the handle for future overwrites, or null if user cancelled / API unavailable. */
export async function saveToFile(state: AppState): Promise<FileSystemFileHandle | null> {
  if (typeof window === 'undefined' || !('showSaveFilePicker' in window)) return null;
  try {
    const handle = await (window as Window & { showSaveFilePicker: (o?: unknown) => Promise<FileSystemFileHandle> })
      .showSaveFilePicker({
        suggestedName: DEFAULT_FILENAME,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
    const json = exportStateToJson(state);
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return handle;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    throw err;
  }
}

/** Overwrite a previously chosen file (same session). Returns true if written. */
export async function overwriteFile(state: AppState, handle: FileSystemFileHandle | null): Promise<boolean> {
  if (!handle) return false;
  try {
    const json = exportStateToJson(state);
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/** File System Access API: open a file and return parsed state, or null if cancelled / invalid / API unavailable. */
export async function openFromFile(): Promise<AppState | null> {
  if (typeof window === 'undefined' || !('showOpenFilePicker' in window)) return null;
  try {
    const [fileHandle] = await (window as Window & { showOpenFilePicker: (o?: unknown) => Promise<FileSystemFileHandle[]> })
      .showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        multiple: false,
      });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return importStateFromJson(text);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    throw err;
  }
}

export function isSaveToFileSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}
