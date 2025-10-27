export interface UploadFileRequest {
  key: string;
  // fileBuffer: string; // base64 encoded
  fileBuffer: Buffer;
  contentType: string;
}

export interface UploadFileResponse {
  url: string;
}
