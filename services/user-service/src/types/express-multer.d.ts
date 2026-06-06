// Type definitions for Multer integration
declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      destination: string;
      filename: string;
      path: string;
      buffer: Buffer;
    }

    interface Options {
      dest?: string | undefined;
      storage?: StorageEngine | undefined;
      limits?: {
        fieldNameSize?: number | undefined;
        fieldSize?: number | undefined;
        fields?: number | undefined;
        fileSize?: number | undefined;
        files?: number | undefined;
        parts?: number | undefined;
        headerPairs?: number | undefined;
      } | undefined;
      fileFilter?: ((req: Request, file: File, cb: (error: Error | null, acceptFile: boolean) => void) => void) | undefined;
      preservePath?: boolean | undefined;
    }

    interface StorageEngine {
      _handleFile(req: Express.Request, file: File, callback: (error?: any, info?: Partial<File>) => void): void;
      _removeFile(req: Express.Request, file: File, callback: (error?: Error | null) => void): void;
    }
  }
}
