import { extractTextFromPDF } from "../pdf/extractTextFromPDF";
import { getImagesFromPDF } from "../pdf/getImagesFromPDF";
import { ocrImageToRecipe } from "./ocrImageToRecipe";
import { InputType, textToRecipe } from "./textToRecipe";

export const pdfToRecipe = async (pdf: Uint8Array, maxPages?: number) => {
  const text = await extractTextFromPDF(pdf, maxPages);

  if (!text) {
    // Many PDFs don't actually contain text, but rather are just an image
    // We fall back here to grabbing an image from the PDF, then OCRing that
    const images = await getImagesFromPDF(pdf, 1);
    if (!images.length) return;

    const recipe = await ocrImageToRecipe(images[0]);
    return recipe;
  }

  const recipe = await textToRecipe(text, InputType.Document);
  return recipe;
};