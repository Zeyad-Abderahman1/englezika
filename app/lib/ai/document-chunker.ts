export interface DocumentChunk {
  index: number;
  stratum: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export const TOTAL_STRATA = 15;
export const TARGET_CHUNK_CHARS = 1200;

/**
 * 15-Strata Sampling across full document text.
 * Guarantees uniform coverage of beginning, middle, and end of document
 * respecting paragraph and sentence boundaries, avoiding first-page bias.
 */
export function chunkDocumentStratified(
  text: string,
  strataCount = TOTAL_STRATA,
  chunkSize = TARGET_CHUNK_CHARS
): DocumentChunk[] {
  const trimmed = text.trim();
  const totalLength = trimmed.length;

  if (totalLength <= chunkSize) {
    return [
      {
        index: 0,
        stratum: 1,
        text: trimmed,
        startOffset: 0,
        endOffset: totalLength,
      },
    ];
  }

  const strataInterval = totalLength / strataCount;
  const chunks: DocumentChunk[] = [];
  let lastEnd = 0;

  for (let stratum = 0; stratum < strataCount; stratum++) {
    const idealStart = Math.floor(stratum * strataInterval);

    // Search for clean boundary (paragraph or sentence break) near idealStart
    let startOffset = idealStart;
    if (idealStart > lastEnd) {
      const windowAround = trimmed.slice(Math.max(lastEnd, idealStart - 100), Math.min(totalLength, idealStart + 100));
      const breakMatch = windowAround.search(/\n\n|\n|[.?!؟]\s+/);
      if (breakMatch !== -1) {
        startOffset = Math.max(lastEnd, idealStart - 100) + breakMatch;
        // Skip the break character itself
        if (trimmed[startOffset] === '\n') startOffset += 1;
        if (trimmed[startOffset] === '\n') startOffset += 1;
      }
    } else {
      startOffset = lastEnd;
    }

    // Determine end offset respecting paragraph or sentence break
    let endOffset = Math.min(totalLength, startOffset + chunkSize);
    if (endOffset < totalLength) {
      const endWindow = trimmed.slice(endOffset - 100, Math.min(totalLength, endOffset + 100));
      const endBreak = endWindow.search(/\n\n|\n|[.?!؟]\s+/);
      if (endBreak !== -1) {
        endOffset = endOffset - 100 + endBreak;
      }
    }

    const chunkContent = trimmed.slice(startOffset, endOffset).trim();
    if (chunkContent.length >= 80) {
      chunks.push({
        index: chunks.length,
        stratum: stratum + 1,
        text: chunkContent,
        startOffset,
        endOffset,
      });
      lastEnd = endOffset;
    }

    if (endOffset >= totalLength) break;
  }

  // If sampling produced fewer chunks due to very short text, ensure at least beginning & end are present
  if (chunks.length === 0) {
    chunks.push({
      index: 0,
      stratum: 1,
      text: trimmed.slice(0, chunkSize),
      startOffset: 0,
      endOffset: Math.min(totalLength, chunkSize),
    });
  }

  return chunks;
}

/**
 * Combines stratified chunks into diverse context slices for a specific batch.
 * Selects chunks from different strata across the document (e.g. beginning, middle, and end).
 */
export function selectContextForBatch(
  chunks: DocumentChunk[],
  batchIndex: number,
  totalBatches: number,
  maxChars = 2500
): string {
  if (chunks.length <= 2) {
    return chunks.map((c) => c.text).join('\n\n---\n\n');
  }

  // Interleave strata across batches so each batch sees different parts of the document
  const selected: DocumentChunk[] = [];
  const step = Math.max(1, Math.floor(chunks.length / totalBatches));
  const startIndex = (batchIndex * step) % chunks.length;

  for (let i = 0; i < chunks.length; i++) {
    const idx = (startIndex + i * totalBatches) % chunks.length;
    const chunk = chunks[idx];
    if (!selected.includes(chunk)) {
      selected.push(chunk);
    }
    const currentLength = selected.reduce((sum, c) => sum + c.text.length, 0);
    if (currentLength >= maxChars) break;
  }

  // Sort by stratum order to maintain document flow
  selected.sort((a, b) => a.stratum - b.stratum);
  return selected.map((c) => `[قسم من الوثيقة - طبقة ${c.stratum}]:\n${c.text}`).join('\n\n');
}
