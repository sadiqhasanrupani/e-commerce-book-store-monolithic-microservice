export const BOOKS_CONFIG = {
  get CLIENTS() {
    return {
      name: 'BOOKS_SERVICE',
      transport: 0,
      options: {
        host: 'localhost',
        port: 3001,
      },
    };
  },
} as const;
