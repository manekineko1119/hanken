// Cloud Vision の頼み方と、返事から行を取り出す。純粋な関数だけ（Deno の API・fetch・env は使わない）。
// 画像や読み取った文字は、ログに出さない。

export const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

export function visionBody(images) {
  return {
    requests: images.map((content) => ({
      image: { content },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      imageContext: { languageHints: ['ja'] },
    })),
  };
}

function upstream(message) {
  const e = new Error(message);
  e.code = 'UPSTREAM';
  return e;
}

function wordConfidence(w) {
  if (typeof w.confidence === 'number') return w.confidence;
  const cs = (w.symbols ?? []).map((s) => s.confidence).filter((c) => typeof c === 'number');
  return cs.length ? Math.min(...cs) : 0;
}

// 1枚ぶんの返事を行にする
function linesOfImage(res, image) {
  const lines = [];
  let text = '';
  let conf = null;
  const flush = () => {
    const t = text.trim();
    if (t) lines.push({ text: t, confidence: conf ?? 0, image });
    text = '';
    conf = null;
  };
  for (const page of res.fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const w of para.words ?? []) {
          const syms = w.symbols ?? [];
          text += syms.map((s) => s.text ?? '').join('');
          const c = wordConfidence(w);
          conf = conf === null ? c : Math.min(conf, c);
          const brk = syms.length ? syms[syms.length - 1].property?.detectedBreak?.type : undefined;
          if (brk === 'SPACE' || brk === 'SURE_SPACE') text += ' ';
          // 行末・ハイフン止めは、そこで行を閉じる
          else if (brk === 'EOL_SURE_SPACE' || brk === 'LINE_BREAK' || brk === 'HYPHEN') flush();
        }
        flush(); // 段落の終わりで残りを閉じる
      }
    }
  }
  return lines;
}

export function linesFromVision(json) {
  const responses = json?.responses;
  if (!Array.isArray(responses)) throw upstream('Vision の返事の形が違う');
  const out = [];
  let ok = 0;
  responses.forEach((res, i) => {
    if (!res || res.error) return;
    ok++;
    out.push(...linesOfImage(res, i));
  });
  if (responses.length > 0 && ok === 0) throw upstream('Vision がすべての画像でエラーを返した');
  return out;
}
