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

/**
 * Generate a clean query with typed values
 * */
export function castQuery(query: Record<string, string | string[] | undefined>) {
  // Use Record<string, any> or a specific interface for the output
  const casted: Record<string, any> = {};

  for (const key in query) {
    const val = query[key];

    // Handle undefined or empty cases
    if (val === undefined || val === null) continue;

    // Handle arrays (if your query has ?tag=a&tag=b)
    if (Array.isArray(val)) {
      casted[key] = val;
      continue;
    }

    if (val === 'true') {
      casted[key] = true;
    } else if (val === 'false') {
      casted[key] = false;
    } else {
      // FIX: Convert to number first to satisfy isNaN, 
      // but only assign if it's a valid number string
      const num = Number(val);
      if (val.trim() !== '' && !isNaN(num)) {
        casted[key] = num;
      } else {
        casted[key] = val;
      }
    }
  }
  return casted;
}
