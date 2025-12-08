// src/OpenAI/OCRUtils.ts
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import vision from "@google-cloud/vision";
import fsPromises from "fs/promises";

const MAX_OCR_CHARS = 20000;
const MAX_OCR_LONG_EDGE = 1600;

const credentials = process.env.GCP_VISION_API
  ? JSON.parse(process.env.GCP_VISION_API)
  : undefined;

const visionClient = new vision.ImageAnnotatorClient(
  credentials ? { credentials } : {}
);

export async function extractTextFromImageFile(
  file: Express.Multer.File
): Promise<string> {
  const start = performance.now();
  const filePath = file.path;
  const mime = file.mimetype;

  try {
    // ---- PDF PATH (Vision, first 5 pages) ----
    if (mime === "application/pdf") {
      const pdfBytes = await fsPromises.readFile(filePath);

      const request = {
        requests: [
          {
            inputConfig: {
              mimeType: "application/pdf",
              content: pdfBytes,
            },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            pages: [1, 2, 3, 4, 5],
          },
        ],
      };

      const [batchResult] = await visionClient.batchAnnotateFiles(
        request as any
      );

      const fileResponses = batchResult.responses?.[0]?.responses ?? [];

      let fullText = "";
      for (const resp of fileResponses) {
        const pageText = resp.fullTextAnnotation?.text;
        if (pageText) {
          fullText += pageText + "\n";
        }
      }

      const text = fullText.trim();
      const end = performance.now();
      console.log(
        `extractTextFromImageFile (Vision PDF) got ${text.length} chars in ${(
          end - start
        ).toFixed(0)} ms`
      );

      if (!text) return "";
      return text.slice(0, MAX_OCR_CHARS);
    }

    // ---- IMAGE PATH ----
    // sharp can take a file path directly
    const resizedBuffer = await sharp(filePath)
      .resize({
        width: MAX_OCR_LONG_EDGE,
        height: MAX_OCR_LONG_EDGE,
        fit: "inside",
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    const [result] = await visionClient.textDetection({
      image: { content: resizedBuffer },
    });

    const text = result.fullTextAnnotation?.text ?? "";

    const end = performance.now();
    console.log(
      `extractTextFromImageFile (Vision image) took ${(end - start).toFixed(
        0
      )} ms`
    );

    if (!text) return "";
    return text.slice(0, MAX_OCR_CHARS);
  } catch (err) {
    const end = performance.now();
    console.error(
      `extractTextFromImageFile (Vision) failed after ${(end - start).toFixed(
        0
      )} ms`,
      err
    );
    throw new Error("Error Parsing Image");
  }
}
