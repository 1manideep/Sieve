// Bytes to text without mojibake or throws (70 section 3.2). The rules live in web/src/robust/charset.ts and the
// parser-free entity decoder in web/src/robust/question.ts; 20's readers and mime.ts keep importing from here.
export { decodeBase64UrlBytes, decodeBytes, type Decoded } from '@/robust/charset';
export { decodeEntities } from '@/robust/question';
