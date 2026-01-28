# Running from a Thumb Drive

Use this app on another computer (e.g. from a USB stick). **Python** on the other computer is enough—no Node needed there.

## What to put on the thumb drive

Copy this whole folder onto the drive. It should include:

- **`dist/`** – the built app (create once with the steps below)
- **`run.bat`** – double-click on Windows to start the app
- **`run.sh`** – on Mac/Linux: `chmod +x run.sh` then `./run.sh`
- **`assets/`** – reference images (optional)
- **`PORTABLE.md`** – this file

## One-time build (on a machine that has Node)

From this folder:

```bash
npm install
npm run build
```

After that, **`dist/`** contains the app. Copy the whole folder (including `dist/`) to the thumb drive.

## Running on the other computer

1. Plug in the thumb drive.
2. **Windows:** Double-click **`run.bat`**.  
   **Mac/Linux:** In a terminal, run `./run.sh` from this folder.
3. The script starts a small server with **Python** (or Node if you have it) and opens the app in your browser at http://localhost:5173.

You need **Python** (or Node) installed on that computer. The script will tell you if neither is found.

## Data and backups

- Data is stored in the **browser’s localStorage** on that computer. It does not travel with the thumb drive.
- Use the app’s **Save to file** / **Open from file** or **Download backup** / **Import backup** to move data between computers (e.g. save a file to the thumb drive and import it on the other PC).

## Summary

| Step | Action |
|------|--------|
| 1 | On a machine with Node: run `npm install` and `npm run build` once. |
| 2 | Copy this whole folder to the thumb drive. |
| 3 | On the other PC: run **`run.bat`** (Windows) or **`./run.sh`** (Mac/Linux). |
| 4 | Use Save/Open or backup/import in the app to move data between computers. |
