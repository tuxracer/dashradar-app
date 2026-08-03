import type { OnnxMetadata } from "./types";

export * from "./types";

/**
 * Protobuf wire types. An `.onnx` file is a serialized `ModelProto`, and the
 * top-level fields this reader wants are all length-delimited (2), so the rest
 * exist only to be skipped correctly. Groups (3 and 4) are deprecated, absent
 * from onnx.proto, and carry no length to skip by, so meeting one means the
 * bytes are not what we think they are.
 */
const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH = 2;
const WIRE_FIXED32 = 5;

/** ModelProto field numbers (onnx.proto). */
const MODEL_PRODUCER_NAME = 2;
const MODEL_PRODUCER_VERSION = 3;
const MODEL_DOC_STRING = 6;
const MODEL_GRAPH = 7;
const MODEL_METADATA_PROPS = 14;

/** StringStringEntryProto field numbers, the shape of one metadata_props pair. */
const ENTRY_KEY = 1;
const ENTRY_VALUE = 2;

/**
 * Longest run of bytes this reader will decode as text. Nothing a release
 * stamps comes close, while the graph it walks past is tens of megabytes, so
 * the cap is what keeps a corrupt length or a field number that means something
 * else in a future opset from turning into a huge string allocation inside the
 * worker at the exact moment memory is tightest (see createModel's note on the
 * weights buffer). An oversized field is skipped, not fatal.
 */
const MAX_STRING_BYTES = 64 * 1024;

/** Position in the buffer, carried through the walk so reads can advance it. */
type Cursor = { readonly bytes: Uint8Array; pos: number };

const decoder = new TextDecoder();

/**
 * Read one base-128 varint, advancing the cursor past it. Values accumulate by
 * multiplication rather than `<<`, which is a 32-bit operation in JS and would
 * wrap on the byte lengths in a 57 MB file.
 */
const readVarint = (cursor: Cursor, end: number): number => {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (cursor.pos >= end) {
      throw new RangeError("varint runs past the end of the message");
    }
    const byte = cursor.bytes[cursor.pos];
    cursor.pos += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return value;
    }
    shift += 7;
    if (shift > 63) {
      throw new RangeError("varint is longer than 64 bits");
    }
  }
};

/**
 * Decode the span from the cursor to `end` as UTF-8, without moving the cursor
 * (the walk sets the position from the field's declared length either way).
 * Returns undefined for a span past {@link MAX_STRING_BYTES}, so one absurd
 * field costs that field and not the whole read. A subarray, never a slice:
 * this runs on the model weights, where an extra copy is the thing being
 * avoided.
 */
const readString = (cursor: Cursor, end: number): string | undefined => {
  if (end - cursor.pos > MAX_STRING_BYTES) {
    return undefined;
  }
  return decoder.decode(cursor.bytes.subarray(cursor.pos, end));
};

/**
 * Walk the fields of one message, calling `visit` for each length-delimited
 * field with the cursor at the value's first byte and the position its value
 * ends at. Fields of other wire types are skipped, as is anything the visitor
 * chooses not to read: this is what lets the walk step over the graph, tens of
 * megabytes of weights included, by reading its length and jumping.
 *
 * Throws on anything malformed rather than guessing, so the caller can treat a
 * file that is not a ModelProto as simply having no metadata.
 */
const walkMessage = (
  cursor: Cursor,
  end: number,
  visit: (field: number, valueEnd: number) => void,
): void => {
  while (cursor.pos < end) {
    const key = readVarint(cursor, end);
    const field = key >>> 3;
    switch (key & 0b111) {
      case WIRE_LENGTH: {
        const length = readVarint(cursor, end);
        const valueEnd = cursor.pos + length;
        if (valueEnd > end) {
          throw new RangeError("field runs past the end of the message");
        }
        visit(field, valueEnd);
        cursor.pos = valueEnd;
        break;
      }
      case WIRE_VARINT:
        readVarint(cursor, end);
        break;
      case WIRE_FIXED64:
        cursor.pos += 8;
        break;
      case WIRE_FIXED32:
        cursor.pos += 4;
        break;
      default:
        throw new RangeError("unsupported protobuf wire type");
    }
  }
  if (cursor.pos !== end) {
    throw new RangeError("message overran its declared length");
  }
};

/** Read one metadata_props pair into `into`, skipping a half-written entry. */
const readProp = (
  cursor: Cursor,
  end: number,
  into: Record<string, string>,
): void => {
  let key: string | undefined;
  let value: string | undefined;
  walkMessage(cursor, end, (field, valueEnd) => {
    if (field === ENTRY_KEY) {
      key = readString(cursor, valueEnd);
    }
    if (field === ENTRY_VALUE) {
      value = readString(cursor, valueEnd);
    }
  });
  if (key !== undefined && value !== undefined) {
    into[key] = value;
  }
};

/**
 * Read what an `.onnx` file says about itself out of its own bytes.
 *
 * Only the top-level ModelProto fields are read; the graph is stepped over by
 * length rather than parsed, so this costs a few dozen varint reads no matter
 * how large the file is. Per-tensor doc strings would need a descent into the
 * graph and nothing needs them yet.
 *
 * Returns undefined when the bytes are not a ModelProto: either they do not
 * parse as protobuf at all, or they parse but carry no graph, which is the one
 * field every real model has and the check that stops arbitrary bytes from
 * decoding into a plausible-looking empty result.
 */
export const readOnnxMetadata = (
  bytes: Uint8Array,
): OnnxMetadata | undefined => {
  const cursor: Cursor = { bytes, pos: 0 };
  const props: Record<string, string> = {};
  let producerName: string | undefined;
  let producerVersion: string | undefined;
  let docString: string | undefined;
  let sawGraph = false;
  try {
    walkMessage(cursor, bytes.length, (field, valueEnd) => {
      switch (field) {
        case MODEL_PRODUCER_NAME:
          producerName = readString(cursor, valueEnd);
          break;
        case MODEL_PRODUCER_VERSION:
          producerVersion = readString(cursor, valueEnd);
          break;
        case MODEL_DOC_STRING:
          docString = readString(cursor, valueEnd);
          break;
        case MODEL_GRAPH:
          sawGraph = true;
          break;
        case MODEL_METADATA_PROPS:
          readProp(cursor, valueEnd, props);
          break;
        default:
          break;
      }
    });
  } catch {
    return undefined;
  }
  if (!sawGraph) {
    return undefined;
  }
  return { producerName, producerVersion, docString, props };
};
