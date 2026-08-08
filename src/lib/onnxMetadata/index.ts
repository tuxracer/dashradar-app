import type { OnnxMetadata } from "./types";

export * from "./types";

/**
 * Protobuf wire types. Every top-level field this reader wants is
 * length-delimited, so the rest exist only to be skipped correctly. Groups (3
 * and 4) are absent from onnx.proto and carry no length to skip by, so meeting
 * one means the bytes are not a ModelProto.
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
 * Longest run of bytes decoded as text. Nothing a release stamps comes close,
 * while the graph walked past is tens of megabytes, so this keeps a corrupt
 * length from becoming a huge allocation at the moment memory is tightest. An
 * oversized field is skipped, not fatal.
 */
const MAX_STRING_BYTES = 64 * 1024;

/** Position in the buffer, carried through the walk so reads can advance it. */
type Cursor = { readonly bytes: Uint8Array; pos: number };

const decoder = new TextDecoder();

/**
 * Read one base-128 varint. Values accumulate by multiplication rather than
 * `<<`, which is 32-bit in JS and would wrap on this file's byte lengths.
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
 * Decode the span to `end` as UTF-8 without moving the cursor, which the walk sets
 * from the declared length anyway. A subarray, never a slice: this runs on the
 * weights, where an extra copy is the thing being avoided.
 */
const readString = (cursor: Cursor, end: number): string | undefined => {
  if (end - cursor.pos > MAX_STRING_BYTES) {
    return undefined;
  }
  return decoder.decode(cursor.bytes.subarray(cursor.pos, end));
};

/**
 * Walk one message, calling `visit` per length-delimited field with the cursor at
 * the value's first byte. Anything the visitor does not read is skipped by
 * length, which is what lets the walk step over tens of megabytes of graph.
 * Throws on anything malformed rather than guessing.
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
 * Read what an `.onnx` file says about itself. Only top-level fields; the graph is
 * stepped over by length, so this costs a few dozen varint reads whatever the
 * file size. Undefined when the bytes do not parse or carry no graph, the check
 * that stops arbitrary bytes decoding into a plausible empty result.
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
