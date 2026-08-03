import { isPlainObject, isString } from "remeda";

/**
 * What an ONNX file says about itself, read straight out of the downloaded
 * bytes. Every field is optional because an export only carries what its
 * producer wrote: a file exported before the release runbook started stamping
 * provenance parses fine and reports nothing but a producer name.
 *
 * onnxruntime-web's JS API exposes none of this (it surfaces input/output
 * names, types and shapes and nothing about the model itself), so the only way
 * to read it in the browser is to parse the file, which is what
 * `readOnnxMetadata` does.
 */
export type OnnxMetadata = {
  /** ONNX `producer_name`, e.g. "pytorch" for a torch export. */
  producerName?: string;
  /** ONNX `producer_version`, the exporting framework's version. */
  producerVersion?: string;
  /** ONNX `doc_string`, prose describing the model. */
  docString?: string;
  /**
   * ONNX `metadata_props`, the arbitrary key/value pairs an export stamps onto
   * the file. The checkpoint repo's release runbook writes `release_tag`,
   * `roboflow_model_id`, `torch_version`, and `names` (a JSON map of class
   * index to label). Empty for a file that was never stamped, which is every
   * build shipped so far. Values are strings; anything structured is encoded.
   */
  props: Readonly<Record<string, string | undefined>>;
};

export const isOnnxMetadata = (value: unknown): value is OnnxMetadata => {
  return (
    isPlainObject(value) &&
    (value.producerName === undefined || isString(value.producerName)) &&
    (value.producerVersion === undefined || isString(value.producerVersion)) &&
    (value.docString === undefined || isString(value.docString)) &&
    isPlainObject(value.props) &&
    Object.values(value.props).every(isString)
  );
};
