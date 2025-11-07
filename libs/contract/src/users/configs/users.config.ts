export const USER_CONFIG = {
  get CLIENTS() {
    return {
      name: 'USER_SERVICE',
      transport: 0,
      options: {
        host: 'localhost',
        port: 3001,
      },
    };
  },
} as const;
