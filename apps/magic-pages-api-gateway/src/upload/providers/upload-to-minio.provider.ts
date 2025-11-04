import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import path from 'path';
import { v4 as uuidv4 } from "uuid"

import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { v4 } from 'uuid';

@Injectable()
export class UploadToStorageProvider {
  private readonly logger = new Logger(UploadToStorageProvider.name);
  private readonly s3: S3Client;
  private readonly bucketName: string;
  private readonly endpoint: string;

  constructor(private readonly configService: ConfigService) {
    // Get raw endpoint and ensure it has protocol
    const rawEndpoint = this.configService.get<string>('s3.storageEndpoint') || '';
    
    // Add protocol if missing
    if (rawEndpoint && !rawEndpoint.startsWith('http://') && !rawEndpoint.startsWith('https://')) {
      // Default to http:// for local development
      const port = this.configService.get<string>('s3.storagePort') || '9000';
      this.endpoint = `http://${rawEndpoint}:${port}`;
      this.logger.log(`Added protocol to endpoint: ${this.endpoint}`);
    } else {
      this.endpoint = rawEndpoint;
    }
    
    this.bucketName = this.configService.get<string>('s3.storageBucket') || '';
    
    // Log configuration for debugging
    this.logger.log(`S3/MinIO Configuration:
      Endpoint: ${this.endpoint}
      Bucket: ${this.bucketName}
      Region: ${this.configService.get<string>('s3.storageRegion') || 'us-east-1'}
      Using credentials: ${Boolean(this.configService.get<string>('s3.storageAccessKey'))}
    `);

    // Ensure credentials are not undefined
    const accessKeyId = this.configService.get<string>('s3.storageAccessKey') || '';
    const secretAccessKey = this.configService.get<string>('s3.storageSecretKey') || '';
    const region = this.configService.get<string>('s3.storageRegion') || 'us-east-1';
    
    this.s3 = new S3Client({
      region,
      endpoint: this.endpoint, // Works for both MinIO and Spaces
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Always use path style for S3-compatible services
      // MinIO requires path-style URLs (http://localhost:9000/bucket/key)
    });
  }

  /**
   * Upload multiple files to S3-compatible storage (MinIO / DigitalOcean Spaces)
   */
  async uploadFiles(files: Express.Multer.File[]): Promise<string[]> {
    const uploadedUrls: string[] = [];
    for (const file of files) {
      const fileName = await this.generateFileName(file);

      const uploadParams = {
        Bucket: this.bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read' as const, // Make files public on DigitalOcean
      };

      try {
        // Log request details for debugging
        this.logger.log(`Attempting to upload to bucket '${this.bucketName}' at endpoint '${this.endpoint}'`);
        this.logger.log(`Upload params: ${JSON.stringify({
          Bucket: uploadParams.Bucket,
          Key: uploadParams.Key,
          ContentType: uploadParams.ContentType,
          Size: file.buffer.length
        })}`);
        
        const result = await this.s3.send(new PutObjectCommand(uploadParams));
        
        this.logger.log(`Upload result: ${JSON.stringify(result)}`);

        // Generate file URL - different format based on environment
        let url: string;
        if (this.configService.get<string>('NODE_ENV') === 'production') {
          // For production (DigitalOcean Spaces)
          // Format: https://bucket-name.region.digitaloceanspaces.com/filename
          url = `https://${this.bucketName}.${this.endpoint.replace(/^https?:\/\//, '')}/${fileName}`;
        } else {
          // For local development (MinIO)
          // Format: http://localhost:9000/bucket-name/filename
          url = `${this.endpoint}/${this.bucketName}/${fileName}`;
        }

        this.logger.log(`✅ Uploaded: ${url}`);
        uploadedUrls.push(url);
      } catch (err) {
        this.logger.error(`❌ Upload failed: ${file.originalname}`);
        
        // Add more detailed error logging
        if (err.$metadata) {
          this.logger.error(`Status code: ${err.$metadata.httpStatusCode}`);
          this.logger.error(`Request ID: ${err.$metadata.requestId}`);
        }
        
        if (err.Code) {
          this.logger.error(`Error code: ${err.Code}`);
          this.logger.error(`Error message: ${err.message}`);
        }
        
        throw err;
      }
    }

    return uploadedUrls;
  }

  async generateFileName(file: Express.Multer.File) {
    // Extract filename
    const name = file.filename.split('.')[0];
   
    // Remove white spaces
    name.replace(/\s/g, '').trim();
   
    // extract the extension
    const extension = path.extname(file.originalname);
    // generate time stamp
    const timestamp = new Date().getTime().toString().trim();

    // return file uuid
    return `${name}-${timestamp}-${uuidv4()}${extension}`

  }
}
