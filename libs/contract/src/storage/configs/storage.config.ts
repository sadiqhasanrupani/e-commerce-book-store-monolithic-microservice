export const STORAGE_CONFIG = {
  get CLIENTS() {
    return {
      name: 'STORAGE_SERVICE',
      transport: 0,
      options: {
        host: 'localhost',
        port: 3002,
      },
    };
  },
} as const;
