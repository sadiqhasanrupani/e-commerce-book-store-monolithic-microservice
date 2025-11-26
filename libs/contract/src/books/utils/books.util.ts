/**
 * Extracts the object storage key (path inside the bucket) from a full URL.
 *
 * Handles:
 *  - MinIO  (http://localhost:9000/bucket/path/file.pdf)
 *  - S3     (https://bucket.s3.amazonaws.com/path/file.pdf)
 *  - Spaces (https://bucket.region.digitaloceanspaces.com/path/file.pdf)
 *  - CDN URLs (https://cdn.example.com/path/file.pdf)
 *  - Signed URLs (?X-Amz-Signature=...)
 *
 * Output ALWAYS looks like:
 *    "bucket/path/file.pdf"
 * or if bucket isn't part of the URL:
 *    "path/file.pdf"
 *
 * @param url - raw URL stored in DB
 * @returns string | null - sanitized storage key
 */
export function extractStorageKeyFromUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;

  try {
    // Strip query params (signed URLs, CDN tokens, etc.)
    const cleanUrl = url.split('?')[0];

    const u = new URL(cleanUrl);

    // Normalize path
    let key = u.pathname.replace(/^\/+/, ''); // remove leading "/"
    key = key.replace(/\/+$/, '');            // remove trailing "/"

    if (!key) return null;

    /**
     * Case 1: Standard S3 virtual-host style:
     *   https://bucket.s3.amazonaws.com/path/file.pdf
     * Host looks like: "<bucket>.s3.amazonaws.com"
     *
     * We must ensure we do not accidentally prepend bucket twice.
     */
    const hostParts = u.hostname.split('.');
    const bucketCandidate = hostParts[0] ?? null;

    const isAwsStyle =
      u.hostname.includes('amazonaws.com') ||
      u.hostname.includes('digitaloceanspaces.com') ||
      u.hostname.includes('s3.') ||
      u.hostname.includes('r2.cloudflarestorage.com');

    if (isAwsStyle) {
      // If bucket is already included in key, return as-is.
      if (bucketCandidate && key.startsWith(bucketCandidate + '/')) {
        return key;
      }

      // Otherwise, prepend it:
      if (bucketCandidate) {
        return `${bucketCandidate}/${key}`;
      }
    }

    /**
     * Case 2: MinIO with path-style bucket URLs:
     *   http://localhost:9000/the-magic-pages/books/file.pdf
     * Path looks like: "/the-magic-pages/books/file.pdf"
     *
     * The path already contains the bucket, so we return it as-is.
     */
    return key;
  } catch (err) {
    /**
     * Fallback logic if URL parsing fails:
     *  - Strip protocol if present
     *  - Drop hostname
     *  - Return remaining path
     */
    try {
      const noProto = url.replace(/^https?:\/\//, '');
      const parts = noProto.split('/');
      if (parts.length <= 1) return null;
      return parts.slice(1).join('/');
    } catch {
      return null;
    }
  }
}
