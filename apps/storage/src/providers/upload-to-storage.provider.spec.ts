import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";

import { UploadToStorageProvider } from "./upload-to-storage.provider";
import { GlobalConfigModule } from "@app/global-config";


describe('uploadToStorageService', async () => {
  let configService: ConfigService;

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [GlobalConfigModule],
    providers: [UploadToStorageProvider]
  }).compile();

  configService = moduleRef.get<ConfigService>(ConfigService);
});
