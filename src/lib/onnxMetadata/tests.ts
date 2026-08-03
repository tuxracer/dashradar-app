import { describe, expect, it } from "vitest";
import { isOnnxMetadata, readOnnxMetadata } from "./index";

/**
 * Minimal protobuf encoder, enough to build the ModelProto shapes the reader
 * has to survive. Hand-built rather than fixture files so a case like a
 * truncated field or an oversized string can be expressed at all.
 */
const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return bytes;
};

const tag = (field: number, wire: number): number[] => varint(field * 8 + wire);

/** A length-delimited (wire type 2) field. */
const bytesField = (field: number, payload: number[]): number[] => [
  ...tag(field, 2),
  ...varint(payload.length),
  ...payload,
];

const utf8 = (value: string): number[] => [...new TextEncoder().encode(value)];

const stringField = (field: number, value: string): number[] =>
  bytesField(field, utf8(value));

/** A varint (wire type 0) field, e.g. ModelProto.ir_version. */
const varintField = (field: number, value: number): number[] => [
  ...tag(field, 0),
  ...varint(value),
];

/** One metadata_props entry: StringStringEntryProto{key = 1, value = 2}. */
const prop = (key: string, value: string): number[] =>
  bytesField(14, [...stringField(1, key), ...stringField(2, value)]);

/**
 * A graph large enough to prove the walk steps over it by length instead of
 * reading it. Its contents are deliberately not valid GraphProto: nothing
 * should ever look inside.
 */
const graph = (size = 4096): number[] =>
  bytesField(7, new Array<number>(size).fill(0xff));

const model = (...parts: number[][]): Uint8Array =>
  new Uint8Array(parts.flat());

/** A stamped export, in the field order onnx.save writes. */
const stamped = model(
  varintField(1, 10),
  stringField(2, "pytorch"),
  stringField(3, "2.13.0"),
  stringField(6, "RF-DETR Small detector for Las Vegas Metro police vehicles."),
  graph(),
  prop("names", '{"1": "police"}'),
  prop("release_tag", "v3.7"),
  prop("torch_version", "2.13.0"),
);

describe("readOnnxMetadata", () => {
  it("reads the producer, doc string and stamped props", () => {
    expect(readOnnxMetadata(stamped)).toEqual({
      producerName: "pytorch",
      producerVersion: "2.13.0",
      docString: "RF-DETR Small detector for Las Vegas Metro police vehicles.",
      props: {
        names: '{"1": "police"}',
        release_tag: "v3.7",
        torch_version: "2.13.0",
      },
    });
  });

  it("reads an unstamped export as present but empty", () => {
    const result = readOnnxMetadata(
      model(varintField(1, 10), stringField(2, "pytorch"), graph()),
    );

    expect(result?.producerName).toBe("pytorch");
    expect(result?.props).toEqual({});
    expect(result?.docString).toBeUndefined();
  });

  it("steps over fields it does not read, whatever their wire type", () => {
    const result = readOnnxMetadata(
      model(
        varintField(5, 0),
        [...tag(9, 5), 1, 2, 3, 4],
        [...tag(10, 1), 1, 2, 3, 4, 5, 6, 7, 8],
        bytesField(8, utf8("an opset entry")),
        graph(),
        stringField(2, "pytorch"),
      ),
    );

    expect(result?.producerName).toBe("pytorch");
  });

  it("skips a string too large to be metadata but keeps the rest", () => {
    const result = readOnnxMetadata(
      model(
        stringField(6, "x".repeat(70_000)),
        graph(),
        stringField(2, "pytorch"),
      ),
    );

    expect(result?.docString).toBeUndefined();
    expect(result?.producerName).toBe("pytorch");
  });

  it("rejects bytes that carry no graph, so they are not a model", () => {
    expect(readOnnxMetadata(model(stringField(2, "pytorch")))).toBeUndefined();
    expect(readOnnxMetadata(new Uint8Array(0))).toBeUndefined();
  });

  it("rejects a field whose length runs past the end", () => {
    const truncated = model(graph(), [...tag(2, 2), ...varint(64)], utf8("hi"));

    expect(readOnnxMetadata(truncated)).toBeUndefined();
  });

  it("rejects an unterminated varint", () => {
    expect(
      readOnnxMetadata(model(graph(), [0x80, 0x80, 0x80])),
    ).toBeUndefined();
  });

  it("rejects a group field, which has no length to skip by", () => {
    expect(readOnnxMetadata(model(graph(), tag(20, 3)))).toBeUndefined();
  });

  it("rejects arbitrary bytes", () => {
    const random = new Uint8Array(256);
    for (let i = 0; i < random.length; i += 1) {
      random[i] = (i * 37 + 11) % 256;
    }

    expect(readOnnxMetadata(random)).toBeUndefined();
  });
});

describe("isOnnxMetadata", () => {
  it("accepts what the reader produces, across a message boundary", () => {
    expect(isOnnxMetadata(structuredClone(readOnnxMetadata(stamped)))).toBe(
      true,
    );
  });

  it("accepts a metadata object with nothing but empty props", () => {
    expect(isOnnxMetadata({ props: {} })).toBe(true);
  });

  it("rejects missing or mistyped fields", () => {
    expect(isOnnxMetadata(undefined)).toBe(false);
    expect(isOnnxMetadata({})).toBe(false);
    expect(isOnnxMetadata({ props: { release_tag: 3.7 } })).toBe(false);
    expect(isOnnxMetadata({ props: {}, producerName: 1 })).toBe(false);
  });
});
