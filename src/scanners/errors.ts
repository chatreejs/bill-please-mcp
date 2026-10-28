/**
 * The image was fine but held no usable receipt text, for example a blurry photo
 * or a picture of something else. The REST route answers 422 instead of 502.
 */
export class UnreadableReceiptError extends Error {
  override name = 'UnreadableReceiptError';
}
