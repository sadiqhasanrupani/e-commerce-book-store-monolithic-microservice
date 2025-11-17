import { Controller, Inject } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { STORAGE_PATTERN } from '@app/contract/storage/patterns/storage.pattern';
import { UploadToStorageProvider } from './providers/upload-to-storage.provider';
import {
  DeleteFilesRequest,
  DeleteFilesResponse,
  MoveFilesRequest,
  MoveFilesResponse,
} from '@app/contract/storage/types/storage.type';

/**
 * Microservice controller for storage operations.
 * Uses MinioService to handle file uploads and downloads.
 */
@Controller()
export class StorageController {
  constructor(
    /**
     * Injecting uploadToStorageProvider
     * */
    private readonly uploadToStorageProvider: UploadToStorageProvider,
  ) {}

  /**
   * Handles uploading a file.
   * Expects payload:
   * {
   *   key: string,
   *   fileBuffer: Buffer (or base64 string),
   *   contentType: string
   * }
   */
  @MessagePattern(STORAGE_PATTERN.UPLOAD)
  async handleUpload(
    @Payload() payload: { key: string; fileBuffer: { type: string; data: number[] }; contentType: string },
  ) {
    // Reconstruct a true Buffer
    const buffer = Buffer.from(payload.fileBuffer.data);

    const url = await this.uploadToStorageProvider.uploadFileFromBuffer(payload.key, buffer, payload.contentType);

    return { url };
  }

  /**
   * Handles downloading a file.
   * Expects payload:
   * { key: string }
   * Returns base64 string of the file contents.
   */
  @MessagePattern(STORAGE_PATTERN.DOWNLOAD)
  async handleDownload(@Payload() payload: { key: string }) {
    const fileStream = await this.uploadToStorageProvider.getFile(payload.key);

    const chunks: Buffer[] = [];
    for await (const chunk of fileStream) {
      chunks.push(chunk as Buffer);
    }
    const fileBuffer = Buffer.concat(chunks);
    return { fileBase64: fileBuffer.toString('base64') };
  }

  @MessagePattern(STORAGE_PATTERN.DELETE)
  async handleDeleteFiles(@Payload() data: DeleteFilesRequest): Promise<DeleteFilesResponse> {
    return await this.uploadToStorageProvider.deleteFiles(data);
  }

  @MessagePattern(STORAGE_PATTERN.MOVE)
  async handleMoveFiles(@Payload() data: MoveFilesRequest): Promise<MoveFilesResponse> {
    return await this.uploadToStorageProvider.handleMoveFiles(data);
  }
}
