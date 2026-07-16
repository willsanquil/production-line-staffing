import type { RootState } from '../types';
import { exportRootStateToJson, importBackupFromJson, type ImportedBackup } from './persist';

const DEFAULT_FILENAME = 'production-line-staffing.json';

/** File System Access API: save root state to a real file. */
export async function saveToFile(root: RootState): Promise<FileSystemFileHandle | null> {
  if (typeof window === 'undefined' || !('showSaveFilePicker' in window)) return null;
  try {
    const handle = await (
      window as Window & { showSaveFilePicker: (o?: unknown) => Promise<FileSystemFileHandle> }
    ).showSaveFilePicker({
      suggestedName: DEFAULT_FILENAME,
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
    const json = exportRootStateToJson(root);
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return handle;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    throw err;
  }
}

/** Overwrite a previously chosen file (same session). */
export async function overwriteFile(root: RootState, handle: FileSystemFileHandle | null): Promise<boolean> {
  if (!handle) return false;
  try {
    const json = exportRootStateToJson(root);
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/** File System Access API: open a backup file (RootState or legacy AppState). */
export async function openFromFile(): Promise<ImportedBackup | null> {
  if (typeof window === 'undefined' || !('showOpenFilePicker' in window)) return null;
  try {
    const [fileHandle] = await (
      window as Window & { showOpenFilePicker: (o?: unknown) => Promise<FileSystemFileHandle[]> }
    ).showOpenFilePicker({
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return importBackupFromJson(text);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    throw err;
  }
}

export function isSaveToFileSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}
