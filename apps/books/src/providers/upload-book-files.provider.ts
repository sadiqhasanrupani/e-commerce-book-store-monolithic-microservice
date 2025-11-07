import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

// patterns
import { STORAGE_PATTERN } from '@app/contract/storage/patterns/storage.pattern';

// types
import { BufferType } from '../types/upload-book-file.type';
import { UploadFileRequest, UploadFileResponse } from '../types/storage.type';
import { STORAGE_CONFIG } from '@app/contract/storage/configs/storage.config';

@Injectable()
export class UploadBookFilesProvider {
  constructor(
    /**
     * Injecting storageClient
     * */
    @Inject(STORAGE_CONFIG.CLIENTS.name)
    private readonly storageClient: ClientProxy,
  ) { } //eslint-disable-line

  /**
   * Upload multiple pdf file (from multer).
   * @param files Express Multer files
   * @returns list of URLs
   * */
  public async uploadPdfs(files: Express.Multer.File[]): Promise<string[]> {
    try {
      const urls = await Promise.all(files.map((file) => this.uploadPdf(file)));

      return urls;
    } catch (error) {
      // Option 2: Generic HttpException (if you want custom status)
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to upload one or more PDF files',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Upload Single pdf file (from multer).
   * @param file Express Multer files
   * @returns list of URLs
   * */
  public async uploadPdf(file: Express.Multer.File): Promise<string> {
    const payload: UploadFileRequest = {
      key: `books/${Date.now()}-${file.originalname}`,
      // fileBuffer: file.buffer.toString('base64'),
      fileBuffer: file.buffer,
      contentType: file.mimetype,
    };

    const response = await firstValueFrom(
      this.storageClient.send<UploadFileResponse, UploadFileRequest>(
        STORAGE_PATTERN.UPLOAD,
        payload,
      ),
    );

    return response.url;
  }

  /**
   * Upload multiple buffers (or in the sense snapshot pngs) 
   * @param buffers list of objects {buffer, filename, mimetype}
   * @returns array of uploaded URLs
   * */
  public async uploadBuffers(buffers: BufferType[]) {
    try {
      /**
       * This will return the list of url when all the Promises resolved
       * */
      const urls = await Promise.all(
        buffers.map(async (b) => {
          // we need three properties
          // 1. key => url key
          // 2. filename => name of the filename
          // 3. mimetype => mimetype of the file
          const payload: UploadFileRequest = {
            key: `/books/snapshots/${Date.now()}-${b.filename}`,
            fileBuffer: b.buffer,
            contentType: b.mimetype
          }

          const resp = await firstValueFrom(
            this.storageClient.send<UploadFileResponse, UploadFileRequest>(
              STORAGE_PATTERN.UPLOAD,
              payload
            )
          )

          return resp.url
        })
      )

      return urls;
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to upload snapshot images',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
