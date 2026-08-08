import { isPlainObject, isString } from "remeda";

/**
 * What an ONNX file says about itself, read out of the downloaded bytes. Every
 * field is optional, since an export only carries what its producer wrote.
 * onnxruntime-web's API exposes none of this, so parsing the file is the only
 * way to read it in the browser.
 */
export type OnnxMetadata = {
  /** ONNX `producer_name`, e.g. "pytorch" for a torch export. */
  producerName?: string;
  /** ONNX `producer_version`, the exporting framework's version. */
  producerVersion?: string;
  /** ONNX `doc_string`, prose describing the model. */
  docString?: string;
  /**
   * ONNX `metadata_props`, the key/value pairs an export stamps onto the file.
   * The release runbook writes `release_tag`, `roboflow_model_id`,
   * `torch_version`, and `names`. Values are strings; structure is encoded.
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
