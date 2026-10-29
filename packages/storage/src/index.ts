import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '@pf/config';

/**
 * Object storage (RustFS locally, any S3-compatible service in production).
 * Holds run screenshots: what the browser actually saw when something went
 * unexpectedly, so a failure on a real account can be understood, not guessed.
 */
const client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

/** Returns the object's bytes, or undefined if it doesn't exist. */
export async function getObject(key: string): Promise<{ body: Uint8Array; contentType: string } | undefined> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!res.Body) return undefined;
    return { body: await res.Body.transformToByteArray(), contentType: res.ContentType ?? 'application/octet-stream' };
  } catch (error) {
    if ((error as { name?: string }).name === 'NoSuchKey') return undefined;
    throw error;
  }
}
