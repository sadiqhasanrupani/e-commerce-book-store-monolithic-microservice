import { Injectable } from '@nestjs/common';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { PaginationQueryDto } from '@app/contract/common/pagination/dtos/pagination-query.dto';

/**
 * A reusable provider for paginating TypeORM entities.
 *
 * Supports both Repository-based queries (simple pagination)
 * and QueryBuilder-based queries (complex filtering/sorting).
 */
@Injectable()
export class PaginationProvider {
  /**
   * Paginates a query from either a Repository or a SelectQueryBuilder.
   *
   * @param paginationQuery - DTO containing pagination parameters.
   * @param source - Either a TypeORM Repository or QueryBuilder instance.
   * @returns A tuple containing `[data, total]`.
   */
  public async paginateQuery<T extends ObjectLiteral>(
    paginationQuery: PaginationQueryDto,
    source: Repository<T> | SelectQueryBuilder<T>,
  ): Promise<[T[], number]> {
    const page = paginationQuery.page ?? 1;
    const limit = paginationQuery.limit ?? 10;
    const skip = (page - 1) * limit;

    // Handle QueryBuilder
    if ('getManyAndCount' in source) {
      const qb = source;
      return qb.skip(skip).take(limit).getManyAndCount();
    }

    // Handle Repository
    const repo = source;
    return repo.findAndCount({
      skip,
      take: limit,
    });
  }
}
