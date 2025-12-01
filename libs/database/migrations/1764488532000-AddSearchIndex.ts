import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSearchIndex1764488532000 implements MigrationInterface {
  name = 'AddSearchIndex1764488532000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pg_trgm extension for fuzzy matching
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // Create GIN index on tsv column
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_books_tsv" ON "books" USING GIN ("tsv")`);

    // Create function to update tsv column
    await queryRunner.query(`
            CREATE OR REPLACE FUNCTION books_tsvector_trigger() RETURNS trigger AS $$
            BEGIN
              new.tsv :=
                setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(new.subtitle, '')), 'B') ||
                setweight(to_tsvector('english', coalesce(new."authorName", '')), 'B') ||
                setweight(to_tsvector('english', coalesce(new.description, '')), 'C');
              return new;
            END
            $$ LANGUAGE plpgsql;
        `);

    // Create trigger
    await queryRunner.query(`
            DROP TRIGGER IF EXISTS tsvectorupdate ON books;
            CREATE TRIGGER tsvectorupdate BEFORE INSERT OR UPDATE
            ON books FOR EACH ROW EXECUTE PROCEDURE books_tsvector_trigger();
        `);

    // Update existing rows to populate the tsv column
    await queryRunner.query(`UPDATE books SET id = id`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS tsvectorupdate ON books`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS books_tsvector_trigger`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_books_tsv"`);
  }
}
