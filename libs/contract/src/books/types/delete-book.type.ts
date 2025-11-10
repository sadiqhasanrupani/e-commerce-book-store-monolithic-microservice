export interface DeleteOption {
  /**
   * If true, perform a hard delete: remove files from storage and delete DB row.
   * If false or omitted, perform archive (move files to `archive/` prefix and soft-mark DB).
   * */
  force?: boolean;

  /**
   * Optional archieve prefix (default is 'archive/')
   * */
  archivePrefix?: string;
}
