import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

interface SnapshotOptions {
  maxPages?: number; // how many pages to extract
  dpi?: number; // output resolution
}

/**
 * Generate PNG snapshots from a PDF buffer using `pdftoppm`.
 * Requires `pdftoppm` (poppler-utils) to be installed on the host.
 *
 * @param pdfBuffer Buffer of the PDF file
 * @param options SnapshotOptions
 * @returns Promise<Buffer[]> array of PNG buffers (pages 1..maxPages)
 */
export async function generatePdfSnapshots(
  pdfBuffer: Buffer,
  options: SnapshotOptions = { maxPages: 5, dpi: 150 },
): Promise<Buffer[]> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'pdf-snap-'));
  const pdfPath = path.join(tmpDir, 'input.pdf');

  await fs.writeFile(pdfPath, pdfBuffer);

  // pdftoppm usage:
  // pdftoppm -png -r {dpi} input.pdf outprefix
  const outPrefix = path.join(tmpDir, 'page');

  const dpi = options.dpi ?? 150;
  try {
    // run pdftoppm
    await execFileAsync('pdftoppm', ['-png', '-r', `${dpi}`, pdfPath, outPrefix]);

    // collect files named outPrefix-1.png outPrefix-2.png ...
    const files = await fs.readdir(tmpDir);
    // pdftoppm might produce page-1.png, page-2.png; gather and sort numerically
    const pngFiles = files
      .filter((f) => /\.png$/.test(f))
      .sort((a, b) => {
        const na = parseInt(a.match(/(\d+)\.png$/)?.[1] ?? '0', 10);
        const nb = parseInt(b.match(/(\d+)\.png$/)?.[1] ?? '0', 10);
        return na - nb;
      })
      .slice(0, options.maxPages ?? 5);

    const buffers = await Promise.all(
      pngFiles.map((f) => fs.readFile(path.join(tmpDir, f))),
    );

    // cleanup
    await Promise.all(
      (await fs.readdir(tmpDir)).map((f) => fs.unlink(path.join(tmpDir, f))),
    );
    await fs.rmdir(tmpDir);

    return buffers;
  } catch (err) {
    // attempt cleanup
    try {
      (await fs.readdir(tmpDir)).map((f) => fs.unlink(path.join(tmpDir, f)));
      await fs.rmdir(tmpDir);
    } catch (_) {}
    throw new Error(`Failed to generate snapshots: ${err.message || err}`);
  }
}
