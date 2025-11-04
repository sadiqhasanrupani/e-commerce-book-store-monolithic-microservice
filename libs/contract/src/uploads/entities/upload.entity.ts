import { UploadMime } from '../enums/upload-mime.enum';
import { UploadType } from '../enums/upload-type.enum';

export class Upload {
  id: string;
  name: string;
  path: string;
  type: UploadType;
  mime: UploadMime;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}
