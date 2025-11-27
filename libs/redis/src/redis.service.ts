import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';

import { REDIS_CLIENT } from './constants/radis.constant';
@Injectable()
export class RedisService {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) { }

    get client(): Redis {
        return this.redis;
    }

    async set(key: string, value: string, ttl?: number): Promise<void> {
        if (ttl) {
            await this.redis.set(key, value, 'EX', ttl);
        } else {
            await this.redis.set(key, value);
        }
    }

    async get(key: string): Promise<string | null> {
        return this.redis.get(key);
    }

    async del(key: string): Promise<void> {
        await this.redis.del(key);
    }
}
