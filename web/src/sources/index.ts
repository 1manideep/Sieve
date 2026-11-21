// Sources (docs/spec/20-index-and-sources.md sections 14 to 17): Gmail, the local folder, uploads, photos.
// 01 section 9 assigns no functions to this module; these are the calls 40 CR-4 and 20 section 14.1 agree on.

export {
  startSources, stopSources, connectGmail, connectFolder, reauthorize, disconnectSource, setIndexingPaused, rebuildIndex,
  syncNow, getQueue, getPrivacyQueue, startBackground, preloadGis, revokeGmailAccess,
} from './registry';
export type { SourcePhase, SkipReason, SourceErrorCode } from './types';
export { SourceError, SOURCE_COPY } from './types';

export { addUploads, filesFromDataTransfer } from './uploads';
export type { UploadResult } from './uploads';

export { readFolderFile, PermissionNeededError } from './folder/connect';
export { walkFolder, isIgnored, fileTypeOf } from './folder/walk';
export type { FileEntry } from './folder/walk';
export { scanFolder } from './folder/scan';

export { readFileForIndex, readBlobText, extractPdfText, chatToText } from './readers';
export type { ReadResult } from './readers';

export { readPhotoMeta } from './photos/exif';
export { makeThumbnail, getThumbnailUrl, getPhotoBlob, imageDims } from './photos/image';

export { getGmailToken, clearGmailToken, requestGmailToken, revokeGmailToken, gmailClientId } from './gmail/auth';
export { UnitBucket } from './gmail/rateLimit';
export { gmailFetch, getProfile, listMessages, getMessage, listHistory, GmailAuthError, GmailNotFoundError, GmailForbiddenError, GmailRateError } from './gmail/api';
export type { GmailMessage, GmailPart, GmailHistory } from './gmail/api';
export { header, decodeMimeWords, decodeBase64Url, extractBodies, decodeSnippet, isSkippable, isTrashed } from './gmail/mime';
export { buildGmailQuery, liveGmailSearch, hydrateGmail } from './gmail/liveSearch';
export { runGmailSync } from './gmail/sync';
