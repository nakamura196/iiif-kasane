// Image API request URLs that ask for "the largest the server gives". Internal (the leading underscore keeps it out of the
// public API): `singleImageUrl` in image.ts and the Download tab share this one rule for the size keyword.
import type { ImageRegion, ImageServiceRef } from './image';

/** `native` in Image API 1, `default` after. */
export const imageQuality = (version: 1 | 2 | 3) => (version === 1 ? 'native' : 'default');

/** The size keyword for the largest image: `max` in Image API 3 (which rejects `full`), `full` before (2.0 rejects `max`). */
export const largestKeyword = (version: 1 | 2 | 3) => (version === 3 ? 'max' : 'full');

/** The region as a request path part: `full`, or `x,y,w,h` in whole pixels. */
export const regionPart = (region: ImageRegion | 'full'): string =>
  region === 'full' ? 'full' : `${Math.round(region.x)},${Math.round(region.y)},${Math.round(region.w)},${Math.round(region.h)}`;

/** `{id}/{region}/{max|full}/0/{quality}.jpg`: a region at the largest size the server gives. */
export const largestRequestUrl = (service: ImageServiceRef, region: ImageRegion | 'full'): string =>
  `${service.id}/${regionPart(region)}/${largestKeyword(service.version)}/0/${imageQuality(service.version)}.jpg`;
