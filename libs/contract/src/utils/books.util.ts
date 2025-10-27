import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

type UploadType = 'pdf' | 'xls' | 'photo' | 'other';

/**
 * Generate clean file name with type and timestamp
 */
export function generateFileName(file: Express.Multer.File, type: UploadType): string {
  const baseName = path.parse(file.originalname).name.replace(/\s+/g, '_');
  const ext = path.extname(file.originalname);
  const timestamp = Date.now();
  return `${type}/${baseName}_${timestamp}_${uuidv4()}${ext}`;
}
