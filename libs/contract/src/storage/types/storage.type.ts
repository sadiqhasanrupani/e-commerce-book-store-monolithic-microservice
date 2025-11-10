export type UploadType = 'pdf' | 'xls' | 'photo' | 'other';

export interface DeleteFilesRequest {
  keys: string[];
}

export interface DeleteFilesResponse {
  deleted: string[];
  failed: string[];
}

export interface MoveFilesRequest {
  keys: string[];
  destinationPrefix: string;
}

export interface MoveFilesResponse {
  moved: string[];
  failed: string[];
}
